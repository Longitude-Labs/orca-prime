/**
 * The PR Manager's lists. Mine is read once when the page first opens and Added once at that load
 * and when a PR is pasted; after that only Cmd-R (refresh) or Load more reads GitHub. No timers.
 *
 * Why a standalone store: the lists are page-local, and only the Added refs persist (UI state).
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import {
  applyAddedSnapshots,
  planPrManagerRefresh,
  pruneSettledAddedEntries,
  removeAddedEntry,
  upsertAddedEntry,
  type PrManagerRefreshTrigger
} from '../../../../shared/github/pr-manager/pr-manager-list'
import {
  parsePullRequestUrl,
  pullRequestRefKey
} from '../../../../shared/github/pr-manager/pr-manager-url'
import type {
  PrManagerAddedEntry,
  PrManagerRef,
  PrManagerRow
} from '../../../../shared/github/pr-manager/pr-manager-types'

export type PrManagerSelection = {
  ref: PrManagerRef
  /** Set for a stack member opened from the header switcher; it is not added to the sidebar. */
  transientRow?: PrManagerRow
}

export type PrManagerState = {
  hydrated: boolean
  initialLoadStarted: boolean
  added: PrManagerAddedEntry[]
  mine: PrManagerRow[]
  mineHasMore: boolean
  mineEndCursor: string | null
  mineStatus: 'idle' | 'loading' | 'ready' | 'error'
  mineError: string | null
  loadingMore: boolean
  refreshing: boolean
  /** Bumped by Cmd-R so the open PR's detail rereads without remounting. */
  refreshGeneration: number
  pendingAddKeys: string[]
  selection: PrManagerSelection | null
  query: string
}

const initialState: PrManagerState = {
  hydrated: false,
  initialLoadStarted: false,
  added: [],
  mine: [],
  mineHasMore: false,
  mineEndCursor: null,
  mineStatus: 'idle',
  mineError: null,
  loadingMore: false,
  refreshing: false,
  refreshGeneration: 0,
  pendingAddKeys: [],
  selection: null,
  query: ''
}

export const usePrManagerStore = create<PrManagerState>(() => initialState)

let hydration: Promise<void> | null = null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function persistAdded(added: PrManagerAddedEntry[]): void {
  window.api.ui.set({ prManagerAdded: added }).catch(console.error)
}

function setAdded(update: (added: PrManagerAddedEntry[]) => PrManagerAddedEntry[]): void {
  const next = pruneSettledAddedEntries(update(usePrManagerStore.getState().added), Date.now())
  usePrManagerStore.setState({ added: next })
  persistAdded(next)
}

function hydrateAdded(): Promise<void> {
  hydration ??= (async () => {
    let saved: PrManagerAddedEntry[] = []
    try {
      const ui = await window.api.ui.get()
      saved = Array.isArray(ui.prManagerAdded) ? ui.prManagerAdded : []
    } catch (error) {
      console.error(error)
    }
    const pending = usePrManagerStore.getState().added
    // A paste that raced hydration stays on top of what was saved.
    const merged = pending.reduce(
      (entries, entry) => upsertAddedEntry(entries, entry.ref, entry.addedAt, entry.snapshot),
      saved
    )
    const added = pruneSettledAddedEntries(merged, Date.now())
    usePrManagerStore.setState({ hydrated: true, added })
    if (added.length !== saved.length || pending.length > 0) {
      persistAdded(added)
    }
  })()
  return hydration
}

async function readAdded(refs: PrManagerRef[]): Promise<PrManagerRef[]> {
  if (refs.length === 0) {
    return []
  }
  const result = await window.api.gh.prManagerRead({ refs })
  setAdded((added) => applyAddedSnapshots(added, result.rows))
  return result.missing
}

async function run(trigger: PrManagerRefreshTrigger): Promise<void> {
  await hydrateAdded()
  const state = usePrManagerStore.getState()
  const plan = planPrManagerRefresh(trigger, {
    mineLoadedCount: state.mine.length,
    mineEndCursor: state.mineEndCursor,
    added: state.added
  })
  const mineRead = plan.mine
    ? (async () => {
        const mine = plan.mine!
        if (mine.append) {
          usePrManagerStore.setState({ loadingMore: true })
        } else if (usePrManagerStore.getState().mine.length === 0) {
          usePrManagerStore.setState({ mineStatus: 'loading' })
        }
        try {
          const page = await window.api.gh.prManagerListMine({
            first: mine.first,
            after: mine.after
          })
          usePrManagerStore.setState((current) => ({
            mine: mine.append ? [...current.mine, ...page.rows] : page.rows,
            mineHasMore: page.hasMore,
            mineEndCursor: page.endCursor,
            mineStatus: 'ready',
            mineError: null
          }))
        } catch (error) {
          usePrManagerStore.setState((current) => ({
            mineStatus: current.mine.length > 0 ? 'ready' : 'error',
            mineError: errorMessage(error)
          }))
          if (trigger.kind !== 'initial') {
            toast.error(
              translate('prManager.mineLoadFailed', 'Could not load your pull requests.'),
              { description: errorMessage(error) }
            )
          }
        } finally {
          usePrManagerStore.setState({ loadingMore: false })
        }
      })()
    : Promise.resolve()
  const addedRead = readAdded(plan.added).catch((error: unknown): PrManagerRef[] => {
    if (trigger.kind !== 'initial') {
      toast.error(
        translate('prManager.addedLoadFailed', 'Could not refresh added pull requests.'),
        {
          description: errorMessage(error)
        }
      )
    }
    return []
  })
  await Promise.all([mineRead, addedRead])
}

/** First page open: read Mine and the saved Added PRs once. */
export function ensurePrManagerLoaded(): void {
  if (usePrManagerStore.getState().initialLoadStarted) {
    return
  }
  usePrManagerStore.setState({ initialLoadStarted: true })
  void run({ kind: 'initial' })
}

/** Cmd-R: reread both lists; the selection and everything outside the page stay as they are. */
export async function refreshPrManager(): Promise<void> {
  if (usePrManagerStore.getState().refreshing) {
    return
  }
  usePrManagerStore.setState((s) => ({
    refreshing: true,
    initialLoadStarted: true,
    refreshGeneration: s.refreshGeneration + 1
  }))
  try {
    await run({ kind: 'refresh' })
  } finally {
    usePrManagerStore.setState({ refreshing: false })
  }
}

export function loadMoreMinePullRequests(): void {
  const state = usePrManagerStore.getState()
  if (state.loadingMore || !state.mineHasMore) {
    return
  }
  void run({ kind: 'load-more' })
}

export function selectPullRequest(selection: PrManagerSelection | null): void {
  usePrManagerStore.setState({ selection })
}

export function setPrManagerQuery(query: string): void {
  usePrManagerStore.setState({ query })
}

/** Opens the PR at once and saves it to Added, unless it is one of mine. Returns false for non-PR text. */
export function addPullRequestFromText(text: string): boolean {
  const ref = parsePullRequestUrl(text)
  if (!ref) {
    return false
  }
  const key = pullRequestRefKey(ref)
  const app = useAppStore.getState()
  if (app.activeView !== 'pr-manager') {
    app.openPrManagerPage()
  }
  ensurePrManagerLoaded()
  selectPullRequest({ ref })
  const state = usePrManagerStore.getState()
  if (state.mine.some((row) => pullRequestRefKey(row) === key)) {
    return true
  }
  usePrManagerStore.setState({ pendingAddKeys: [...state.pendingAddKeys, key] })
  const now = Date.now()
  if (usePrManagerStore.getState().hydrated) {
    setAdded((added) => upsertAddedEntry(added, ref, now))
  } else {
    usePrManagerStore.setState((s) => ({ added: upsertAddedEntry(s.added, ref, now) }))
  }
  void (async () => {
    try {
      await hydrateAdded()
      setAdded((added) => upsertAddedEntry(added, ref, now))
      const missing = await readAdded([ref])
      if (missing.length > 0) {
        setAdded((added) => removeAddedEntry(added, ref))
        toast.error(
          translate('prManager.notFound', 'Could not find {{ref}}.', {
            ref: `${ref.owner}/${ref.repo}#${ref.number}`
          })
        )
        const selected = usePrManagerStore.getState().selection
        if (selected && pullRequestRefKey(selected.ref) === key) {
          selectPullRequest(null)
        }
      }
    } catch (error) {
      toast.error(translate('prManager.addFailed', 'Could not load that pull request.'), {
        description: errorMessage(error)
      })
    } finally {
      usePrManagerStore.setState((s) => ({
        pendingAddKeys: s.pendingAddKeys.filter((pending) => pending !== key)
      }))
    }
  })()
  return true
}

export function removeAddedPullRequest(ref: PrManagerRef): void {
  setAdded((added) => removeAddedEntry(added, ref))
  const selected = usePrManagerStore.getState().selection
  if (selected && pullRequestRefKey(selected.ref) === pullRequestRefKey(ref)) {
    selectPullRequest(null)
  }
}

/** The row the sidebar shows for a ref, from Mine, Added, or the switcher's transient pick. */
export function findPrManagerRow(state: PrManagerState, ref: PrManagerRef): PrManagerRow | null {
  const key = pullRequestRefKey(ref)
  return (
    state.mine.find((row) => pullRequestRefKey(row) === key) ??
    state.added.find((entry) => pullRequestRefKey(entry.ref) === key)?.snapshot ??
    (state.selection?.transientRow && pullRequestRefKey(state.selection.transientRow) === key
      ? state.selection.transientRow
      : null)
  )
}
