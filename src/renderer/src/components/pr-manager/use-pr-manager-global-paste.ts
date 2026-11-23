import { useEffect } from 'react'
import { isEditableTarget } from '@/lib/text-input/focus/editable-target'
import { addPullRequestFromText } from './pr-manager-store'

function ownsTextPaste(target: EventTarget | null): boolean {
  // Terminal input proxies are not "editable" for shortcuts, but they still own a paste.
  return (
    isEditableTarget(target) ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  )
}

/** Cmd-V with no text field focused opens a pasted GitHub PR link in the PR Manager. Other text pastes as usual. */
export function usePrManagerGlobalPaste(): void {
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (
        event.defaultPrevented ||
        ownsTextPaste(event.target) ||
        ownsTextPaste(document.activeElement)
      ) {
        return
      }
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (addPullRequestFromText(text)) {
        event.preventDefault()
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
}
