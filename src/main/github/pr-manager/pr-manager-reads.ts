import { z } from 'zod'
import type {
  PrManagerMinePage,
  PrManagerReadResult,
  PrManagerRef,
  PrManagerRow,
  PrManagerStackMember
} from '../../../shared/github/pr-manager/pr-manager-types'
import {
  PR_MANAGER_MINE_PAGE_SIZE,
  PR_MANAGER_MINE_REFRESH_MAX
} from '../../../shared/github/pr-manager/pr-manager-list'
import { pullRequestRefKey } from '../../../shared/github/pr-manager/pr-manager-url'
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import { extractExecError } from '../../git/command-runner/process-capture/exec-error'
import { acquire, release } from '../execution/github-operation-slots'
import { hydrateGitHubPRStack } from '../pull-requests/stacks/github-pr-stack'
import {
  hasFailingRequiredCheck,
  isFailingRollup,
  mapPrManagerNode,
  prManagerNodeFields,
  prManagerNodeSchema,
  requiredChecksSelection,
  type PrManagerNode
} from './pr-manager-graphql'

const MINE_SEARCH = 'is:pr is:open author:@me archived:false sort:updated-desc'
/** Keeps one aliased read well under GitHub's node and argv limits. */
const REFS_PER_QUERY = 25

const envelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z
    .array(
      z.object({
        type: z.string().optional(),
        message: z.string().optional(),
        path: z.array(z.union([z.string(), z.number()])).optional()
      })
    )
    .optional()
})
type Envelope = z.infer<typeof envelopeSchema>

/** GraphQL answers with partial data and errors on a non-zero exit, so the body is read either way. */
async function graphql(
  query: string,
  variables: string[],
  host: string | undefined
): Promise<Envelope> {
  await acquire()
  let stdout: string
  let failure: unknown
  try {
    stdout = (
      await ghExecFileAsync(['api', 'graphql', '-f', `query=${query}`, ...variables], {
        encoding: 'utf-8',
        // Pin dotcom too so a process-level GH_HOST cannot redirect the read.
        host: host ?? 'github.com'
      })
    ).stdout
  } catch (error) {
    failure = error
    stdout = extractExecError(error).stdout
  } finally {
    release()
  }
  let parsed: ReturnType<typeof envelopeSchema.safeParse> | null = null
  try {
    parsed = envelopeSchema.safeParse(JSON.parse(stdout))
  } catch {
    parsed = null
  }
  if (!parsed?.success || (!parsed.data.data && failure)) {
    throw failure ?? new Error('GitHub returned an unreadable response.')
  }
  return parsed.data
}

function rejectsStackFields(envelope: Envelope): boolean {
  return (envelope.errors ?? []).some(
    (error) => error.type !== 'NOT_FOUND' && /\bstack(Entry)?\b/i.test(`${error.message ?? ''}`)
  )
}

async function graphqlWithStackFallback(
  build: (includeStack: boolean) => { query: string; variables: string[] },
  host: string | undefined
): Promise<Envelope> {
  const withStack = build(true)
  const envelope = await graphql(withStack.query, withStack.variables, host)
  if (!rejectsStackFields(envelope)) {
    return envelope
  }
  const plain = build(false)
  return graphql(plain.query, plain.variables, host)
}

const aliasSchema = z.object({ pullRequest: z.unknown() }).nullish()

/** An aliased `repository { pullRequest }` read; a null repository means GitHub found none. */
function aliasedPullRequest(
  envelope: Envelope,
  alias: string
): { pullRequest: unknown; repositoryMissing: boolean } {
  const value = envelope.data?.[alias]
  const parsed = aliasSchema.safeParse(value)
  return {
    pullRequest: parsed.success ? parsed.data?.pullRequest : undefined,
    repositoryMissing: value === null
  }
}

function parseNode(value: unknown): PrManagerNode | null {
  const parsed = prManagerNodeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Marks rows whose failing rollup includes a required check; only failing rows cost a read. */
async function settleRequiredChecks(
  nodes: readonly { node: PrManagerNode; row: PrManagerRow }[],
  host: string | undefined
): Promise<void> {
  const failing = nodes.filter(({ node, row }) => row.state !== 'merged' && isFailingRollup(node))
  for (let start = 0; start < failing.length; start += REFS_PER_QUERY) {
    const batch = failing.slice(start, start + REFS_PER_QUERY)
    const declarations = batch.map((_, i) => `$o${i}: String!, $n${i}: String!, $p${i}: Int!`)
    const selections = batch.map(
      (_, i) =>
        `r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $p${i}) { ${requiredChecksSelection(`$p${i}`)} } }`
    )
    try {
      const envelope = await graphql(
        `query(${declarations.join(', ')}) { ${selections.join('\n')} }`,
        batch.flatMap(({ row }, i) => [
          '-f',
          `o${i}=${row.owner}`,
          '-f',
          `n${i}=${row.repo}`,
          '-F',
          `p${i}=${row.number}`
        ]),
        host
      )
      batch.forEach(({ row }, i) => {
        row.hasFailingRequiredChecks = hasFailingRequiredCheck(
          aliasedPullRequest(envelope, `r${i}`).pullRequest
        )
      })
    } catch {
      // Without the required-check read the warning stays off rather than guessing.
    }
  }
}

export async function listMyOpenPullRequests(args: {
  first?: number
  after?: string | null
}): Promise<PrManagerMinePage> {
  const first = Math.min(
    PR_MANAGER_MINE_REFRESH_MAX,
    Math.max(1, Math.floor(args.first ?? PR_MANAGER_MINE_PAGE_SIZE))
  )
  const envelope = await graphqlWithStackFallback(
    (includeStack) => ({
      query: `query($search: String!, $first: Int!, $after: String) {
        search(query: $search, type: ISSUE, first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { __typename ... on PullRequest { ${prManagerNodeFields(includeStack)} } }
        }
      }`,
      variables: [
        '-f',
        `search=${MINE_SEARCH}`,
        '-F',
        `first=${first}`,
        ...(args.after ? ['-f', `after=${args.after}`] : [])
      ]
    }),
    undefined
  )
  const search = z
    .object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(z.unknown())
    })
    .parse(envelope.data?.search)
  const parsed = search.nodes.flatMap((value) => {
    const node = parseNode(value)
    return node ? [{ node, row: mapPrManagerNode(node, undefined) }] : []
  })
  await settleRequiredChecks(parsed, undefined)
  return {
    rows: parsed.map(({ row }) => row),
    hasMore: search.pageInfo.hasNextPage,
    endCursor: search.pageInfo.endCursor
  }
}

async function readHostPullRequests(
  refs: readonly PrManagerRef[],
  host: string | undefined
): Promise<PrManagerReadResult> {
  const result: PrManagerReadResult = { rows: [], missing: [] }
  for (let start = 0; start < refs.length; start += REFS_PER_QUERY) {
    const batch = refs.slice(start, start + REFS_PER_QUERY)
    const envelope = await graphqlWithStackFallback((includeStack) => {
      const declarations = batch.map((_, i) => `$o${i}: String!, $n${i}: String!, $p${i}: Int!`)
      const selections = batch.map(
        (_, i) =>
          `r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $p${i}) { ${prManagerNodeFields(includeStack)} } }`
      )
      return {
        query: `query(${declarations.join(', ')}) { ${selections.join('\n')} }`,
        variables: batch.flatMap((ref, i) => [
          '-f',
          `o${i}=${ref.owner}`,
          '-f',
          `n${i}=${ref.repo}`,
          '-F',
          `p${i}=${ref.number}`
        ])
      }
    }, host)
    const parsed: { node: PrManagerNode; row: PrManagerRow }[] = []
    batch.forEach((ref, i) => {
      const alias = `r${i}`
      const repository = aliasedPullRequest(envelope, alias)
      const node = parseNode(repository.pullRequest)
      if (node) {
        parsed.push({ node, row: mapPrManagerNode(node, host) })
        return
      }
      const notFound = (envelope.errors ?? []).some(
        (error) => error.type === 'NOT_FOUND' && error.path?.[0] === alias
      )
      // A read that failed for another reason keeps the last snapshot instead of dropping the PR.
      if (notFound || repository.repositoryMissing || repository.pullRequest === null) {
        result.missing.push(ref)
      }
    })
    await settleRequiredChecks(parsed, host)
    result.rows.push(...parsed.map(({ row }) => row))
  }
  return result
}

export async function readPullRequests(
  refs: readonly PrManagerRef[]
): Promise<PrManagerReadResult> {
  const unique = new Map(refs.map((ref) => [pullRequestRefKey(ref), ref]))
  const byHost = new Map<string, PrManagerRef[]>()
  for (const ref of unique.values()) {
    const host = ref.host ?? ''
    byHost.set(host, [...(byHost.get(host) ?? []), ref])
  }
  const results = await Promise.all(
    [...byHost].map(([host, hostRefs]) => readHostPullRequests(hostRefs, host || undefined))
  )
  return {
    rows: results.flatMap((result) => result.rows),
    missing: results.flatMap((result) => result.missing)
  }
}

/** The stack the header's switcher lists, through the same cached read the review panel uses. */
export async function readPullRequestStack(args: {
  ref: PrManagerRef
  stack: { number: number; position: number; size: number }
}): Promise<PrManagerStackMember[]> {
  const repository = {
    owner: args.ref.owner,
    repo: args.ref.repo,
    ...(args.ref.host ? { host: args.ref.host } : {})
  }
  const stack = await hydrateGitHubPRStack(
    repository,
    args.ref.number,
    { ...args.stack, baseRefName: '' },
    { encoding: 'utf-8' }
  )
  return (stack.entries ?? []).map((entry) => ({
    number: entry.number,
    position: entry.position,
    title: entry.title,
    url: entry.url,
    state:
      entry.state === 'merged' || entry.state === 'closed' || entry.state === 'draft'
        ? entry.state
        : 'open'
  }))
}
