"use client"

import type { RefObject } from "react"
import { ArrowRightToLine } from "lucide-react"
import type { RichComposerHandle } from "./rich-composer"

/** A separate touch target: tapping the placeholder must only focus the editor. */
export function AcceptPromptSuggestion({
  editorRef,
  suggestion,
  label,
  touch = false,
}: {
  editorRef: RefObject<RichComposerHandle | null>
  suggestion: string
  touch?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      className="pointer-events-auto relative z-10 ms-2 inline-flex cursor-pointer items-center whitespace-nowrap rounded border border-border border-b-2 px-1.5 align-middle font-sans text-xs leading-4 text-muted-foreground hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={label}
      title={label}
      onClick={() => {
        const editor = editorRef.current
        // Recheck the live document so a late click cannot overwrite a draft.
        if (!editor?.isEmpty() || !suggestion.trim()) return
        editor.setText(suggestion.trim())
        editor.focus()
      }}
    >
      {touch ? (
        label
      ) : (
        <kbd dir="ltr" className="inline-flex items-center gap-1 font-sans">
          <ArrowRightToLine aria-hidden="true" className="size-3" />
          Tab
        </kbd>
      )}
    </button>
  )
}
