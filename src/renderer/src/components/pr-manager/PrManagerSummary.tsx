import React from 'react'
import { ExternalLink, FolderPlus, TriangleAlert } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { Button } from '@/components/ui/button'
import { GitHubUserAvatar } from '@/components/github/github-user-avatar'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { cn } from '@/lib/class-names'
import type { PrManagerRow } from '../../../../shared/github/pr-manager/pr-manager-types'
import { STATE_TONE, stateLabel, warningLabel } from './PrManagerRow'

/** A PR whose repo is not in Orca: what the list knows, plus the way to the full review. */
export function PrManagerSummary({ row }: { row: PrManagerRow }): React.JSX.Element {
  const t = useTranslate()
  const openModal = useAppStore((s) => s.openModal)
  const warning = warningLabel(row, t)
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="text-[13px] text-muted-foreground">
        {row.owner}/{row.repo} · #{row.number}
      </div>
      <h2 className="mt-1 text-xl font-semibold leading-snug text-foreground">{row.title}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span className={cn('rounded px-1.5 py-px text-[11px] font-medium', STATE_TONE[row.state])}>
          {stateLabel(row.state, t)}
        </span>
        {row.author ? (
          <span className="flex items-center gap-1.5 text-foreground">
            <GitHubUserAvatar
              login={row.author}
              avatarUrl={row.authorAvatarUrl}
              className="size-5 rounded-full"
            />
            {row.author}
          </span>
        ) : null}
        {warning ? (
          <span className="flex items-center gap-1 text-status-warning-text">
            <TriangleAlert className="size-3.5" />
            {warning}
          </span>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => openAppHttpLink(row.url)}>
          <ExternalLink className="size-3.5" />
          {t('prManager.openOnGitHub', 'Open on GitHub')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => openModal('add-repo')}>
          <FolderPlus className="size-3.5" />
          {t('prManager.addProject', 'Add project…')}
        </Button>
      </div>
      <p className="mt-4 max-w-md text-[12px] text-muted-foreground">
        {t(
          'prManager.summaryHint',
          'Conversation, checks and files open here once {{repo}} is a project in Orca.',
          { repo: `${row.owner}/${row.repo}` }
        )}
      </p>
    </div>
  )
}
