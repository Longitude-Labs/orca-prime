import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'

/** The paste chord as the platform writes it; paste is the OS's own key, not an Orca keybinding. */
export function pasteShortcutLabel(): string {
  return getShortcutPlatform() === 'darwin' ? '⌘V' : 'Ctrl+V'
}
