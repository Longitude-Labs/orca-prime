import { z } from 'zod'
import type {
  PrManagerRow,
  PrManagerRowState
} from '../../../shared/github/pr-manager/pr-manager-types'

/** GHES servers without stacked PRs reject the stack fields; reads retry without them. */
export function prManagerNodeFields(includeStack: boolean): string {
  return `number title url state isDraft isInMergeQueue mergeable mergeStateStatus updatedAt closedAt
    repository { name owner { login } }
    author { __typename login avatarUrl }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    ${includeStack ? 'stack { number size } stackEntry { position }' : ''}`
}

const positive = z.number().int().positive()

export const prManagerNodeSchema = z.object({
  number: positive,
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  isInMergeQueue: z.boolean().nullish(),
  mergeable: z.string().nullish(),
  mergeStateStatus: z.string().nullish(),
  updatedAt: z.string(),
  closedAt: z.string().nullish(),
  repository: z.object({ name: z.string(), owner: z.object({ login: z.string() }) }),
  author: z
    .object({ __typename: z.string().optional(), login: z.string(), avatarUrl: z.string() })
    .nullish(),
  commits: z
    .object({
      nodes: z
        .array(
          z
            .object({
              commit: z.object({
                statusCheckRollup: z.object({ state: z.string() }).nullish()
              })
            })
            .nullish()
        )
        .nullish()
    })
    .nullish(),
  stack: z.object({ number: positive, size: positive }).nullish(),
  stackEntry: z.object({ position: positive }).nullish()
})

export type PrManagerNode = z.infer<typeof prManagerNodeSchema>

function rowState(node: PrManagerNode): PrManagerRowState {
  if (node.state === 'MERGED') {
    return 'merged'
  }
  if (node.state === 'CLOSED') {
    return 'closed'
  }
  if (node.isInMergeQueue) {
    return 'queued'
  }
  return node.isDraft ? 'draft' : 'open'
}

export function rollupState(node: PrManagerNode): string | null {
  return node.commits?.nodes?.[0]?.commit.statusCheckRollup?.state ?? null
}

export function isFailingRollup(node: PrManagerNode): boolean {
  const state = rollupState(node)
  return state === 'FAILURE' || state === 'ERROR'
}

export function mapPrManagerNode(node: PrManagerNode, host: string | undefined): PrManagerRow {
  return {
    ...(host ? { host } : {}),
    owner: node.repository.owner.login,
    repo: node.repository.name,
    number: node.number,
    title: node.title,
    url: node.url,
    state: rowState(node),
    author: node.author
      ? node.author.__typename === 'Bot'
        ? `app/${node.author.login}`
        : node.author.login
      : null,
    ...(node.author?.avatarUrl ? { authorAvatarUrl: node.author.avatarUrl } : {}),
    updatedAt: node.updatedAt,
    closedAt: node.closedAt ?? null,
    hasConflicts:
      node.state === 'OPEN' &&
      (node.mergeable === 'CONFLICTING' || node.mergeStateStatus === 'DIRTY'),
    // Settled by a required-check read for rows whose rollup failed.
    hasFailingRequiredChecks: false,
    ...(node.stack && node.stackEntry
      ? {
          stack: {
            number: node.stack.number,
            size: node.stack.size,
            position: node.stackEntry.position
          }
        }
      : {})
  }
}

const FAILING_CHECK_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'STARTUP_FAILURE',
  'ACTION_REQUIRED'
])

const requiredContextSchema = z.union([
  z.object({
    __typename: z.literal('CheckRun'),
    conclusion: z.string().nullish(),
    isRequired: z.boolean()
  }),
  z.object({
    __typename: z.literal('StatusContext'),
    state: z.string(),
    isRequired: z.boolean()
  }),
  z.object({ __typename: z.string() })
])

const requiredChecksPullRequestSchema = z.object({
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z
            .object({ contexts: z.object({ nodes: z.array(requiredContextSchema.nullish()) }) })
            .nullish()
        })
      })
    )
  })
})

export function requiredChecksSelection(numberVariable: string): string {
  return `commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { conclusion isRequired(pullRequestNumber: ${numberVariable}) }
    ... on StatusContext { state isRequired(pullRequestNumber: ${numberVariable}) }
  } } } } } }`
}

export function hasFailingRequiredCheck(pullRequest: unknown): boolean {
  const parsed = requiredChecksPullRequestSchema.safeParse(pullRequest)
  if (!parsed.success) {
    return false
  }
  const contexts = parsed.data.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []
  return contexts.some((context) => {
    if (!context || !('isRequired' in context) || !context.isRequired) {
      return false
    }
    if ('conclusion' in context) {
      return !!context.conclusion && FAILING_CHECK_CONCLUSIONS.has(context.conclusion)
    }
    return 'state' in context && (context.state === 'FAILURE' || context.state === 'ERROR')
  })
}
