import { describe, expect, it } from 'vitest'
import {
  PR_MANAGER_ADDED_DROP_OFF_MS,
  buildPrManagerSections,
  groupRowsByStack,
  planPrManagerRefresh,
  pruneSettledAddedEntries,
  upsertAddedEntry
} from './pr-manager-list'
import type { PrManagerAddedEntry, PrManagerRow } from './pr-manager-types'

function row(number: number, extra: Partial<PrManagerRow> = {}): PrManagerRow {
  return {
    owner: 'acme',
    repo: 'widgets',
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    state: 'open',
    author: 'octocat',
    updatedAt: '2026-11-01T00:00:00Z',
    hasConflicts: false,
    hasFailingRequiredChecks: false,
    ...extra
  }
}

function added(r: PrManagerRow, addedAt = 0): PrManagerAddedEntry {
  return { ref: { owner: r.owner, repo: r.repo, number: r.number }, addedAt, snapshot: r }
}

describe('buildPrManagerSections', () => {
  it('splits mine from added, hides an added PR that is already mine, and offers load more', () => {
    const sections = buildPrManagerSections({
      mine: [row(1), row(2)],
      mineHasMore: true,
      added: [added(row(2)), added(row(9, { author: 'someone' }))],
      query: ''
    })
    expect(sections.mine.map((b) => b.kind === 'row' && b.row.number)).toEqual([1, 2])
    expect(sections.added.map((b) => b.kind === 'row' && b.row.number)).toEqual([9])
    expect(sections.mineHasMore).toBe(true)
  })

  it('searches only rows already in the sidebar and withholds load more while searching', () => {
    const sections = buildPrManagerSections({
      mine: [row(1, { title: 'Fix login' }), row(2, { title: 'Docs' })],
      mineHasMore: true,
      added: [added(row(9, { title: 'Other', author: 'ada' })), added(row(10, { title: 'x' }))],
      query: 'ADA'
    })
    expect(sections.mine).toEqual([])
    expect(sections.added.map((b) => b.kind === 'row' && b.row.number)).toEqual([9])
    expect(sections.mineHasMore).toBe(false)
    const byRepoAndNumber = buildPrManagerSections({
      mine: [row(1), row(2)],
      mineHasMore: false,
      added: [],
      query: 'acme/widgets #2'
    })
    expect(byRepoAndNumber.mine.map((b) => b.kind === 'row' && b.row.number)).toEqual([2])
  })
})

describe('groupRowsByStack', () => {
  it('groups one stack at its first member, top first, and leaves lone members as rows', () => {
    const stack = (number: number, position: number) =>
      row(number, { stack: { number: 5, position, size: 3 } })
    const lone = row(30, { repo: 'other', stack: { number: 5, position: 1, size: 2 } })
    const blocks = groupRowsByStack([
      row(1),
      stack(11, 1),
      row(2),
      stack(13, 3),
      lone,
      stack(12, 2)
    ])
    expect(
      blocks.map((b) => (b.kind === 'row' ? b.row.number : b.rows.map((r) => r.number)))
    ).toEqual([1, [13, 12, 11], 2, 30])
  })
})

describe('pruneSettledAddedEntries', () => {
  it('drops merged or closed PRs a day after they closed and keeps open ones forever', () => {
    const now = Date.parse('2026-11-23T12:00:00Z')
    const closedAgo = (ms: number) => new Date(now - ms).toISOString()
    const entries = [
      added(row(1, { state: 'merged', closedAt: closedAgo(PR_MANAGER_ADDED_DROP_OFF_MS) })),
      added(row(2, { state: 'closed', closedAt: closedAgo(PR_MANAGER_ADDED_DROP_OFF_MS - 1) })),
      added(row(3, { state: 'open' }), 0),
      added(row(4, { state: 'merged', closedAt: null }), now - PR_MANAGER_ADDED_DROP_OFF_MS - 1),
      { ref: { owner: 'acme', repo: 'widgets', number: 5 }, addedAt: 0 }
    ]
    expect(pruneSettledAddedEntries(entries, now).map((e) => e.ref.number)).toEqual([2, 3, 5])
  })
})

describe('upsertAddedEntry', () => {
  it('adds newest first and refreshes an existing entry in place', () => {
    const first = upsertAddedEntry([], { owner: 'a', repo: 'b', number: 1 }, 10)
    const second = upsertAddedEntry(first, { owner: 'a', repo: 'b', number: 2 }, 20)
    const again = upsertAddedEntry(second, { owner: 'A', repo: 'B', number: 1 }, 30, row(1))
    expect(again.map((e) => [e.ref.number, e.addedAt, Boolean(e.snapshot)])).toEqual([
      [2, 20, false],
      [1, 10, true]
    ])
  })
})

describe('planPrManagerRefresh', () => {
  const state = {
    mineLoadedCount: 60,
    mineEndCursor: 'c60',
    added: [added(row(9)), added(row(10))]
  }

  it('reads mine and every added PR at start and on Cmd-R, keeping what Load more revealed', () => {
    expect(planPrManagerRefresh({ kind: 'initial' }, state)).toEqual({
      mine: { first: 25, after: null, append: false },
      added: [state.added[0]!.ref, state.added[1]!.ref]
    })
    expect(planPrManagerRefresh({ kind: 'refresh' }, state).mine).toEqual({
      first: 60,
      after: null,
      append: false
    })
    expect(
      planPrManagerRefresh({ kind: 'refresh' }, { ...state, mineLoadedCount: 500 }).mine
    ).toMatchObject({ first: 100 })
  })

  it('reads only the next mine page on load more and only the pasted PR on add', () => {
    expect(planPrManagerRefresh({ kind: 'load-more' }, state)).toEqual({
      mine: { first: 25, after: 'c60', append: true },
      added: []
    })
    expect(
      planPrManagerRefresh({ kind: 'load-more' }, { ...state, mineEndCursor: null }).mine
    ).toBeNull()
    const ref = { owner: 'x', repo: 'y', number: 3 }
    expect(planPrManagerRefresh({ kind: 'add', ref }, state)).toEqual({ mine: null, added: [ref] })
  })
})
