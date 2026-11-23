import React, { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useShortcutLabel } from '@/lib/keyboard/useShortcutLabel'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { PrManagerList } from './PrManagerList'
import { PrManagerDetail } from './PrManagerDetail'
import { ensurePrManagerLoaded, refreshPrManager, usePrManagerStore } from './pr-manager-store'
import { usePrManagerRefreshChord } from './use-pr-manager-refresh-chord'

export default function PrManagerPage(): React.JSX.Element {
  const t = useTranslate()
  const refreshing = usePrManagerStore((s) => s.refreshing)
  const refreshShortcut = useShortcutLabel('prManager.refresh')
  usePrManagerRefreshChord()
  useEffect(() => {
    ensurePrManagerLoaded()
  }, [])

  return (
    <main
      className="relative flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
      data-pr-manager-page
    >
      <header
        className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3 md:px-5"
        style={{ paddingRight: 'max(0.75rem, var(--window-controls-width, 0px))' }}
      >
        <h1 className="flex-1 truncate text-base font-semibold leading-8">
          {t('prManager.title', 'PR Manager')}
        </h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void refreshPrManager()}
              aria-label={t('prManager.refresh', 'Refresh')}
              disabled={refreshing}
            >
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('prManager.refreshTooltip', 'Refresh ({{shortcut}})', { shortcut: refreshShortcut })}
          </TooltipContent>
        </Tooltip>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 min-w-[16rem] shrink-0 flex-col border-r border-border/60 bg-muted/20">
          <PrManagerList />
        </aside>
        <section className="min-w-0 flex-1">
          <PrManagerDetail />
        </section>
      </div>
    </main>
  )
}
