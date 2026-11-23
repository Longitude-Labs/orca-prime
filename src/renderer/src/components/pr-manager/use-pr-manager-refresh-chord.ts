import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/keyboard/app-keyboard-router'
import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'
import { isImeOwnedKeyboardEvent } from '@/lib/text-input/ime/ime-composition-keyboard-event'
import { keybindingMatchesAction } from '../../../../shared/keybindings/matching'
import { refreshPrManager } from './pr-manager-store'

/** While the PR Manager is open, its refresh chord (Cmd-R) rereads both lists instead of anything else. */
export function usePrManagerRefreshChord(): void {
  useEffect(() => {
    const platform = getShortcutPlatform()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isImeOwnedKeyboardEvent(event)) {
        return
      }
      const { keybindings } = useAppStore.getState()
      if (!keybindingMatchesAction('prManager.refresh', event, platform, keybindings)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) {
        void refreshPrManager()
      }
    }
    addAppKeyListener('keydown', onKeyDown)
    return () => removeAppKeyListener('keydown', onKeyDown)
  }, [])
}
