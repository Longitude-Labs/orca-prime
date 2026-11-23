import type { PrManagerAddedEntry, PrManagerRef, PrManagerRow } from './pr-manager-types'
import { pullRequestRefKey } from './pr-manager-url'

export const PR_MANAGER_MINE_PAGE_SIZE = 25
/** GitHub search returns at most 100 nodes per page; a refresh re-reads what Load more revealed in one call. */
export const PR_MANAGER_MINE_REFRESH_MAX = 100
export const PR_MANAGER_ADDED_DROP_OFF_MS = 24 * 60 * 60 * 1000
export const PR_MANAGER_ADDED_MAX = 200

export type PrManagerBlock =
  | { kind: 'row'; row: PrManagerRow }
  | { kind: 'stack'; key: string; rows: PrManagerRow[] }

export type PrManagerSections = {
  mine: PrManagerBlock[]
  mineHasMore: boolean
  added: PrManagerBlock[]
}

/** Merged and closed added PRs leave a day after GitHub closed them; open ones stay until removed. */
export function pruneSettledAddedEntries(
  entries: readonly PrManagerAddedEntry[],
  now: number
): PrManagerAddedEntry[] {
  return entries.filter((entry) => {
    const row = entry.snapshot
    if (!row || (row.state !== 'merged' && row.state !== 'closed')) {
      return true
    }
    const closedAt = row.closedAt ? Date.parse(row.closedAt) : Number.NaN
    // No close time to measure from: count the day from when it was added.
    const since = Number.isFinite(closedAt) ? closedAt : entry.addedAt
    return now - since < PR_MANAGER_ADDED_DROP_OFF_MS
  })
}

/** Adds the ref (newest first) or refreshes the existing entry's snapshot without reordering. */
export function upsertAddedEntry(
  entries: readonly PrManagerAddedEntry[],
  ref: PrManagerRef,
  now: number,
  snapshot?: PrManagerRow
): PrManagerAddedEntry[] {
  const key = pullRequestRefKey(ref)
  const index = entries.findIndex((entry) => pullRequestRefKey(entry.ref) === key)
  if (index !== -1) {
    if (!snapshot) {
      return [...entries]
    }
    const next = [...entries]
    next[index] = { ...entries[index]!, snapshot }
    return next
  }
  return [{ ref, addedAt: now, ...(snapshot ? { snapshot } : {}) }, ...entries].slice(
    0,
    PR_MANAGER_ADDED_MAX
  )
}

export function removeAddedEntry(
  entries: readonly PrManagerAddedEntry[],
  ref: PrManagerRef
): PrManagerAddedEntry[] {
  const key = pullRequestRefKey(ref)
  return entries.filter((entry) => pullRequestRefKey(entry.ref) !== key)
}

export function applyAddedSnapshots(
  entries: readonly PrManagerAddedEntry[],
  rows: readonly PrManagerRow[]
): PrManagerAddedEntry[] {
  const byKey = new Map(rows.map((row) => [pullRequestRefKey(row), row]))
  return entries.map((entry) => {
    const row = byKey.get(pullRequestRefKey(entry.ref))
    return row ? { ...entry, snapshot: row } : entry
  })
}

/** Matches only rows already in the sidebar: every whitespace-separated term must hit one field. */
export function filterRowsBySearch(rows: readonly PrManagerRow[], query: string): PrManagerRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return [...rows]
  }
  return rows.filter((row) => {
    const haystack = [row.title, `#${row.number}`, `${row.owner}/${row.repo}`, row.author ?? '']
      .join('\n')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

function stackKey(row: PrManagerRow): string | null {
  return row.stack
    ? `${`${row.host ?? 'github.com'}/${row.owner}/${row.repo}`.toLowerCase()}:${row.stack.number}`
    : null
}

/** Rows of one stack sit together at the first member's place, top of the stack first.
 *  A stack with a single visible member stays an ordinary row. */
export function groupRowsByStack(rows: readonly PrManagerRow[]): PrManagerBlock[] {
  const members = new Map<string, PrManagerRow[]>()
  for (const row of rows) {
    const key = stackKey(row)
    if (key) {
      members.set(key, [...(members.get(key) ?? []), row])
    }
  }
  const blocks: PrManagerBlock[] = []
  const placed = new Set<string>()
  for (const row of rows) {
    const key = stackKey(row)
    const stackRows = key ? members.get(key)! : null
    if (!key || !stackRows || stackRows.length < 2) {
      blocks.push({ kind: 'row', row })
      continue
    }
    if (placed.has(key)) {
      continue
    }
    placed.add(key)
    blocks.push({
      kind: 'stack',
      key,
      rows: [...stackRows].sort((a, b) => b.stack!.position - a.stack!.position)
    })
  }
  return blocks
}

export function buildPrManagerSections(args: {
  mine: readonly PrManagerRow[]
  mineHasMore: boolean
  added: readonly PrManagerAddedEntry[]
  query: string
}): PrManagerSections {
  const mineKeys = new Set(args.mine.map(pullRequestRefKey))
  // A pasted link to one of my own PRs already shows under Mine.
  const addedRows = args.added.flatMap((entry) =>
    entry.snapshot && !mineKeys.has(pullRequestRefKey(entry.ref)) ? [entry.snapshot] : []
  )
  const searching = args.query.trim().length > 0
  return {
    mine: groupRowsByStack(filterRowsBySearch(args.mine, args.query)),
    // Load more reads GitHub, so it is offered only when the list is not narrowed to local matches.
    mineHasMore: args.mineHasMore && !searching,
    added: groupRowsByStack(filterRowsBySearch(addedRows, args.query))
  }
}

export type PrManagerRefreshTrigger =
  | { kind: 'initial' }
  | { kind: 'refresh' }
  | { kind: 'load-more' }
  | { kind: 'add'; ref: PrManagerRef }

export type PrManagerRefreshPlan = {
  mine: { first: number; after: string | null; append: boolean } | null
  added: PrManagerRef[]
}

/** What each trigger reads. Nothing reads on a timer: after the first load only Cmd-R refreshes. */
export function planPrManagerRefresh(
  trigger: PrManagerRefreshTrigger,
  state: {
    mineLoadedCount: number
    mineEndCursor: string | null
    added: readonly PrManagerAddedEntry[]
  }
): PrManagerRefreshPlan {
  switch (trigger.kind) {
    case 'initial':
      return {
        mine: { first: PR_MANAGER_MINE_PAGE_SIZE, after: null, append: false },
        added: state.added.map((entry) => entry.ref)
      }
    case 'refresh':
      return {
        mine: {
          first: Math.min(
            PR_MANAGER_MINE_REFRESH_MAX,
            Math.max(PR_MANAGER_MINE_PAGE_SIZE, state.mineLoadedCount)
          ),
          after: null,
          append: false
        },
        added: state.added.map((entry) => entry.ref)
      }
    case 'load-more':
      return {
        mine: state.mineEndCursor
          ? { first: PR_MANAGER_MINE_PAGE_SIZE, after: state.mineEndCursor, append: true }
          : null,
        added: []
      }
    case 'add':
      return { mine: null, added: [trigger.ref] }
  }
}
