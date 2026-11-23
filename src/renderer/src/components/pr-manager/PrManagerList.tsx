import React, { useMemo, useState } from 'react'
import { Link2, Loader2, Search } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslate } from '@/i18n/use-translate'
import { useShortcutLabel } from '@/lib/keyboard/useShortcutLabel'
import { pasteShortcutLabel } from './pr-manager-shortcut-labels'
import { Input } from '@/components/ui/input'
import {
  buildPrManagerSections,
  type PrManagerBlock
} from '../../../../shared/github/pr-manager/pr-manager-list'
import {
  parsePullRequestUrl,
  pullRequestRefKey
} from '../../../../shared/github/pr-manager/pr-manager-url'
import type { PrManagerRow as PrManagerRowData } from '../../../../shared/github/pr-manager/pr-manager-types'
import { PrManagerRow } from './PrManagerRow'
import {
  addPullRequestFromText,
  loadMoreMinePullRequests,
  removeAddedPullRequest,
  selectPullRequest,
  setPrManagerQuery,
  usePrManagerStore
} from './pr-manager-store'

function SectionHeader({
  label,
  count,
  busy
}: {
  label: string
  count: number
  busy?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-muted-foreground/70">{count}</span>
      {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
    </div>
  )
}

function Blocks({
  blocks,
  selectedKey,
  section
}: {
  blocks: PrManagerBlock[]
  selectedKey: string | null
  section: 'mine' | 'added'
}): React.JSX.Element {
  const renderRow = (row: PrManagerRowData): React.JSX.Element => {
    const key = pullRequestRefKey(row)
    return (
      <PrManagerRow
        key={key}
        row={row}
        selected={key === selectedKey}
        showWarning={section === 'mine'}
        onSelect={() => selectPullRequest({ ref: row })}
        onRemove={section === 'added' ? () => removeAddedPullRequest(row) : undefined}
      />
    )
  }
  return (
    <>
      {blocks.map((block) =>
        block.kind === 'row' ? (
          renderRow(block.row)
        ) : (
          // A stack sits between two rules, at the same indent as every other row.
          <div
            key={block.key}
            className="my-1 border-y border-border/70 py-1"
            data-pr-manager-stack={block.key}
          >
            {block.rows.map(renderRow)}
          </div>
        )
      )}
    </>
  )
}

function countRows(blocks: PrManagerBlock[]): number {
  return blocks.reduce((sum, block) => sum + (block.kind === 'row' ? 1 : block.rows.length), 0)
}

export function PrManagerList(): React.JSX.Element {
  const t = useTranslate()
  const refreshShortcut = useShortcutLabel('prManager.refresh')
  const [pasteValue, setPasteValue] = useState('')
  const [pasteInvalid, setPasteInvalid] = useState(false)
  const {
    mine,
    mineHasMore,
    mineStatus,
    mineError,
    loadingMore,
    refreshing,
    added,
    query,
    selection,
    pendingAddKeys
  } = usePrManagerStore(
    useShallow((s) => ({
      mine: s.mine,
      mineHasMore: s.mineHasMore,
      mineStatus: s.mineStatus,
      mineError: s.mineError,
      loadingMore: s.loadingMore,
      refreshing: s.refreshing,
      added: s.added,
      query: s.query,
      selection: s.selection,
      pendingAddKeys: s.pendingAddKeys
    }))
  )
  const sections = useMemo(
    () => buildPrManagerSections({ mine, mineHasMore, added, query }),
    [mine, mineHasMore, added, query]
  )
  const selectedKey = selection ? pullRequestRefKey(selection.ref) : null
  const submitPaste = (text: string): boolean => {
    if (addPullRequestFromText(text)) {
      setPasteValue('')
      setPasteInvalid(false)
      return true
    }
    setPasteInvalid(text.trim().length > 0)
    return false
  }
  const pendingCount = pendingAddKeys.filter(
    (key) => !added.some((entry) => entry.snapshot && pullRequestRefKey(entry.ref) === key)
  ).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 p-2">
        <div className="relative">
          <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={pasteValue}
            onChange={(event) => {
              setPasteValue(event.target.value)
              setPasteInvalid(false)
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text/plain')
              if (parsePullRequestUrl(text)) {
                event.preventDefault()
                submitPaste(text)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitPaste(pasteValue)
              }
            }}
            placeholder={t('prManager.pastePlaceholder', 'Paste a GitHub PR link')}
            aria-label={t('prManager.pasteLabel', 'Add a pull request by link')}
            aria-invalid={pasteInvalid || undefined}
            density="compact"
            inset="leadingIcon"
            data-pr-manager-paste
          />
        </div>
        {pasteInvalid ? (
          <p className="px-1 text-[11px] text-destructive">
            {t('prManager.pasteInvalid', 'That is not a GitHub pull request link.')}
          </p>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setPrManagerQuery(event.target.value)}
            placeholder={t('prManager.searchPlaceholder', 'Filter these pull requests')}
            aria-label={t('prManager.searchLabel', 'Filter pull requests in the sidebar')}
            density="compact"
            inset="leadingIcon"
            data-pr-manager-search
          />
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        <SectionHeader
          label={t('prManager.section.mine', 'Mine')}
          count={countRows(sections.mine)}
          busy={refreshing || mineStatus === 'loading'}
        />
        {mineStatus === 'loading' && mine.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">
            {t('prManager.mineLoading', 'Loading your pull requests…')}
          </p>
        ) : mineStatus === 'error' ? (
          <p className="px-2 py-1 text-[12px] text-destructive" title={mineError ?? undefined}>
            {t(
              'prManager.mineError',
              'Could not load your pull requests. Press {{shortcut}} to retry.',
              {
                shortcut: refreshShortcut
              }
            )}
          </p>
        ) : sections.mine.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">
            {query.trim()
              ? t('prManager.noMatches', 'No matches.')
              : t('prManager.mineEmpty', 'No open pull requests.')}
          </p>
        ) : (
          <Blocks blocks={sections.mine} selectedKey={selectedKey} section="mine" />
        )}
        {sections.mineHasMore ? (
          <button
            type="button"
            onClick={loadMoreMinePullRequests}
            disabled={loadingMore}
            className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-60"
            data-pr-manager-load-more
          >
            {loadingMore ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
            {t('prManager.loadMore', 'Load more…')}
          </button>
        ) : null}
        <SectionHeader
          label={t('prManager.section.added', 'Added')}
          count={countRows(sections.added)}
          busy={pendingCount > 0}
        />
        {sections.added.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">
            {query.trim()
              ? t('prManager.noMatches', 'No matches.')
              : t(
                  'prManager.addedEmpty',
                  'Paste a pull request link above, or press {{paste}} anywhere, to add one.',
                  { paste: pasteShortcutLabel() }
                )}
          </p>
        ) : (
          <Blocks blocks={sections.added} selectedKey={selectedKey} section="added" />
        )}
      </div>
    </div>
  )
}
