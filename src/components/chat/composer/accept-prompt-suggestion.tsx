"use client"

import { CornerDownLeft } from "lucide-react"
import type { RefObject } from "react"
import type { RichComposerHandle } from "./rich-composer"

/** A separate touch target: tapping the placeholder must only focus the editor. */
export function AcceptPromptSuggestion({
  editorRef,
  suggestion,
  label,
}: {
  editorRef: RefObject<RichComposerHandle | null>
  suggestion: string
  label: string
}) {
  return (
    <button
      type="button"
      className="pointer-events-auto relative z-10 ms-0.5 inline-flex h-[1.5em] w-6 cursor-pointer items-center justify-center align-top after:absolute after:inset-x-0 after:-inset-y-0.5 focus-visible:outline-2 focus-visible:outline-ring supports-[height:1lh]:h-[1lh]"
      aria-label={label}
      onClick={() => {
        const editor = editorRef.current
        // Recheck the live document so a late click cannot overwrite a draft.
        if (!editor?.isEmpty() || !suggestion.trim()) return
        editor.setText(suggestion.trim())
        editor.focus()
      }}
    >
      <CornerDownLeft
        aria-hidden="true"
        className="pointer-events-none size-4 text-muted-foreground"
      />
    </button>
  )
}
