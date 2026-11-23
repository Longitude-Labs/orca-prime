import React, { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Layers } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import PullRequestPage from '@/components/pull-request-page/page/surface'
import { useRepoSlugIndex } from '@/lib/workspace/catalog/repo-slug-index'
import { launchWorkItemDirect } from '@/lib/workspace/creation/work-item/launch-work-item-direct'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { invalidateWorkItemDetailsCacheByMatch } from '@/components/github-item-dialog/load-item-details/work-item-details-cache'
import { cn } from '@/lib/class-names'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { GitHubWorkItem } from '../../../../shared/github/work-items/work-item-types'
import type {
  PrManagerRow,
  PrManagerStackMember
} from '../../../../shared/github/pr-manager/pr-manager-types'
import {
  pullRequestRefKey,
  pullRequestRefUrl
} from '../../../../shared/github/pr-manager/pr-manager-url'
import { findPrManagerRow, selectPullRequest, usePrManagerStore } from './pr-manager-store'
import { PrManagerEmptyDetail } from './PrManagerEmptyDetail'
import { PrManagerSummary } from './PrManagerSummary'

function toWorkItem(row: PrManagerRow, repo: Repo): GitHubWorkItem {
  return {
    id: `pr-manager:${pullRequestRefKey(row)}`,
    type: 'pr',
    number: row.number,
    title: row.title,
    state: row.state === 'queued' ? 'open' : row.state,
    url: row.url,
    labels: [],
    updatedAt: row.updatedAt,
    author: row.author,
    ...(row.authorAvatarUrl ? { authorAvatarUrl: row.authorAvatarUrl } : {}),
    prRepo: { owner: row.owner, repo: row.repo, ...(row.host ? { host: row.host } : {}) },
    repoId: repo.id
  }
}

/** Main reads PR details only through a registered clone of the PR's repo (origin or upstream). */
function useContextRepo(row: PrManagerRow | null): { repo: Repo | null; ready: boolean } {
  const { lookupSlug, ready } = useRepoSlugIndex()
  return useMemo(
    () => ({
      repo: row ? (lookupSlug(`${row.owner}/${row.repo}`, row.host)[0] ?? null) : null,
      ready
    }),
    [row, lookupSlug, ready]
  )
}

function StackSwitcher({ row }: { row: PrManagerRow }): React.JSX.Element | null {
  const t = useTranslate()
  const [members, setMembers] = useState<PrManagerStackMember[] | null>(null)
  const stack = row.stack
  const refreshGeneration = usePrManagerStore((s) => s.refreshGeneration)
  const stackKey = stack ? `${pullRequestRefKey(row)}:${stack.number}` : null
  // Reads the current row's stack; the effect below decides when (a new stack, or Cmd-R).
  const readStack = useEffectEvent((): Promise<PrManagerStackMember[]> =>
    stack ? window.api.gh.prManagerStack({ ref: row, stack }) : Promise.resolve([])
  )
  useEffect(() => {
    if (!stackKey) {
      return
    }
    let cancelled = false
    setMembers(null)
    readStack()
      .then((next) => {
        if (!cancelled) {
          setMembers(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMembers([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [stackKey, refreshGeneration])
  if (!stack) {
    return null
  }
  const ordered = [...(members ?? [])].sort((a, b) => b.position - a.position)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" data-pr-manager-stack-switcher>
          <Layers className="size-3.5" />
          {t('prManager.stackPosition', 'Stack · {{position}} of {{size}}', {
            position: stack.position,
            size: stack.size
          })}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {members === null ? (
          <DropdownMenuItem disabled>
            {t('prManager.stackLoading', 'Loading stack…')}
          </DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>
            {t('prManager.stackUnavailable', 'Stack details are unavailable.')}
          </DropdownMenuItem>
        ) : (
          ordered.map((member) => {
            const current = member.number === row.number
            return (
              <DropdownMenuItem
                key={member.number}
                onSelect={() => {
                  if (current) {
                    return
                  }
                  const ref = {
                    ...(row.host ? { host: row.host } : {}),
                    owner: row.owner,
                    repo: row.repo,
                    number: member.number
                  }
                  const known = findPrManagerRow(usePrManagerStore.getState(), ref)
                  // Opening a stack member never adds it to the sidebar.
                  selectPullRequest(
                    known
                      ? { ref, transientRow: known }
                      : {
                          ref,
                          transientRow: {
                            ...ref,
                            title: member.title,
                            url: member.url,
                            state: member.state,
                            author: null,
                            updatedAt: new Date(0).toISOString(),
                            hasConflicts: false,
                            hasFailingRequiredChecks: false,
                            stack: {
                              number: stack.number,
                              size: stack.size,
                              position: member.position
                            }
                          }
                        }
                  )
                }}
                aria-current={current ? 'true' : undefined}
              >
                <span
                  className={cn('flex min-w-0 flex-1 items-center gap-2', current && 'font-medium')}
                >
                  <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
                    {member.position}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{member.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    #{member.number}
                  </span>
                </span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PrManagerDetail(): React.JSX.Element {
  const t = useTranslate()
  const selection = usePrManagerStore((s) => s.selection)
  const row = usePrManagerStore((s) => (s.selection ? findPrManagerRow(s, s.selection.ref) : null))
  const refreshGeneration = usePrManagerStore((s) => s.refreshGeneration)
  const { repo: contextRepo, ready: reposReady } = useContextRepo(row)
  const workItem = useMemo(
    () => (row && contextRepo ? toWorkItem(row, contextRepo) : null),
    [row, contextRepo]
  )

  // Cmd-R rereads the open PR in place: the page keeps its tab, scroll and focus.
  const rereadOpenPullRequest = useEffectEvent((): void => {
    if (!workItem || !contextRepo) {
      return
    }
    invalidateWorkItemDetailsCacheByMatch({
      repoPath: contextRepo.path,
      repoId: contextRepo.id,
      type: 'pr',
      number: workItem.number
    })
  })
  useEffect(() => {
    if (refreshGeneration !== 0) {
      rereadOpenPullRequest()
    }
  }, [refreshGeneration])

  if (!selection) {
    return <PrManagerEmptyDetail />
  }
  const url = row?.url ?? pullRequestRefUrl(selection.ref)
  if (!row || (!contextRepo && !reposReady)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <p>{t('prManager.detailLoading', 'Loading pull request…')}</p>
        <Button variant="outline" size="sm" onClick={() => openAppHttpLink(url)}>
          <ExternalLink className="size-3.5" />
          {t('prManager.openOnGitHub', 'Open on GitHub')}
        </Button>
      </div>
    )
  }
  if (!workItem || !contextRepo) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {row.stack ? (
          <div className="flex shrink-0 items-center border-b border-border/60 px-4 py-1">
            <StackSwitcher row={row} />
          </div>
        ) : null}
        <PrManagerSummary row={row} />
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {row.stack ? (
        <div className="flex shrink-0 items-center border-b border-border/60 px-4 py-1">
          <StackSwitcher row={row} />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <PullRequestPage
          workItem={workItem}
          repoPath={contextRepo.path}
          repoId={contextRepo.id}
          backLabel={t('prManager.title', 'PR Manager')}
          onUse={(item) => {
            void launchWorkItemDirect({
              item,
              repoId: contextRepo.id,
              launchSource: 'task_page',
              telemetrySource: 'sidebar',
              openModalFallback: () => openAppHttpLink(item.url)
            })
          }}
          onClose={() => selectPullRequest(null)}
        />
      </div>
    </div>
  )
}
