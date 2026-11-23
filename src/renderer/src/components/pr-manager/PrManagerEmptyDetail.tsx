import React from 'react'
import { GitPullRequest } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useShortcutLabel } from '@/lib/keyboard/useShortcutLabel'
import { pasteShortcutLabel } from './pr-manager-shortcut-labels'

export function PrManagerEmptyDetail(): React.JSX.Element {
  const t = useTranslate()
  const refreshShortcut = useShortcutLabel('prManager.refresh')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <GitPullRequest className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
      <p className="text-sm font-medium text-foreground">
        {t('prManager.emptyTitle', 'Pick a pull request')}
      </p>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        {t(
          'prManager.emptyBody',
          'Paste a GitHub PR link, or press {{paste}} anywhere in Orca, to open it. {{refresh}} refreshes the lists.',
          { paste: pasteShortcutLabel(), refresh: refreshShortcut }
        )}
      </p>
    </div>
  )
}
