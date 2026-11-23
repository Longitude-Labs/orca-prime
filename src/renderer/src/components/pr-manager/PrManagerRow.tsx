import React from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { GitHubUserAvatar } from '@/components/github/github-user-avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type {
  PrManagerRow as PrManagerRowData,
  PrManagerRowState
} from '../../../../shared/github/pr-manager/pr-manager-types'

export const STATE_TONE: Record<PrManagerRowState, string> = {
  draft: 'bg-muted text-muted-foreground',
  queued: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  open: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  merged: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  closed: 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
}

export function stateLabel(state: PrManagerRowState, t: Translate): string {
  switch (state) {
    case 'draft':
      return t('prManager.state.draft', 'Draft')
    case 'queued':
      return t('prManager.state.queued', 'Queued')
    case 'open':
      return t('prManager.state.open', 'Open')
    case 'merged':
      return t('prManager.state.merged', 'Merged')
    case 'closed':
      return t('prManager.state.closed', 'Closed')
  }
}

export function warningLabel(row: PrManagerRowData, t: Translate): string | null {
  if (row.hasConflicts && row.hasFailingRequiredChecks) {
    return t('prManager.warning.conflictsAndChecks', 'Merge conflicts and failing required checks')
  }
  if (row.hasConflicts) {
    return t('prManager.warning.conflicts', 'Merge conflicts')
  }
  if (row.hasFailingRequiredChecks) {
    return t('prManager.warning.checks', 'Failing required checks')
  }
  return null
}

export function PrManagerRow({
  row,
  selected,
  showWarning,
  onSelect,
  onRemove
}: {
  row: PrManagerRowData
  selected: boolean
  showWarning: boolean
  onSelect: () => void
  onRemove?: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const warning = showWarning ? warningLabel(row, t) : null
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-md transition-colors',
        selected
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'hover:bg-foreground/5'
      )}
      data-pr-manager-row={`${row.owner}/${row.repo}#${row.number}`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GitHubUserAvatar
          login={row.author ?? 'ghost'}
          avatarUrl={row.authorAvatarUrl}
          className="mt-0.5 size-5 shrink-0 rounded-full"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-5">{row.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="shrink-0 tabular-nums">#{row.number}</span>
            <span className="truncate">
              {row.owner}/{row.repo}
            </span>
          </span>
        </span>
        <span
          className={cn(
            'mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-medium leading-4',
            STATE_TONE[row.state]
          )}
        >
          {stateLabel(row.state, t)}
        </span>
        {warning ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mt-0.5 shrink-0 text-status-warning-text">
                <TriangleAlert className="size-4" aria-label={warning} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{warning}</TooltipContent>
          </Tooltip>
        ) : null}
      </button>
      {onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onRemove}
              aria-label={t('prManager.remove', 'Remove from Added')}
              className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('prManager.remove', 'Remove from Added')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
