/** A pull request named by where it lives; `host` is absent for github.com. */
export type PrManagerRef = {
  host?: string
  owner: string
  repo: string
  number: number
}

export type PrManagerRowState = 'draft' | 'queued' | 'open' | 'merged' | 'closed'

export type PrManagerStackMembership = {
  number: number
  position: number
  size: number
}

export type PrManagerRow = PrManagerRef & {
  title: string
  url: string
  state: PrManagerRowState
  author: string | null
  authorAvatarUrl?: string
  updatedAt: string
  /** When GitHub merged or closed it; drives the added section's one-day drop-off. */
  closedAt?: string | null
  hasConflicts: boolean
  hasFailingRequiredChecks: boolean
  stack?: PrManagerStackMembership
}

/** One PR the user pasted. The snapshot paints the row before the first read lands. */
export type PrManagerAddedEntry = {
  ref: PrManagerRef
  addedAt: number
  snapshot?: PrManagerRow
}

export type PrManagerMinePage = {
  rows: PrManagerRow[]
  hasMore: boolean
  endCursor: string | null
}

export type PrManagerReadResult = {
  rows: PrManagerRow[]
  /** Refs GitHub answered with no pull request (deleted, or no access). */
  missing: PrManagerRef[]
}

export type PrManagerStackMember = {
  number: number
  position: number
  title: string
  url: string
  state: PrManagerRowState
}
