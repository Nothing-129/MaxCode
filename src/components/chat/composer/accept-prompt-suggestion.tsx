"use client"

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
      className="pointer-events-auto relative z-10 ml-2 inline-flex cursor-pointer align-[1px] focus-visible:outline-2 focus-visible:outline-ring max-md:ml-1 max-md:align-middle"
      aria-label={label}
      onClick={() => {
        const editor = editorRef.current
        // Recheck the live document so a late click cannot overwrite a draft.
        if (!editor?.isEmpty() || !suggestion.trim()) return
        editor.setText(suggestion.trim())
        editor.focus()
      }}
    >
      <kbd
        dir="ltr"
        className="pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-foreground/10 px-1.5 font-sans text-xs font-medium text-muted-foreground max-md:h-[1.125rem]"
      >
        <span className="relative top-[0.5px] max-md:top-0">⇥ Tab</span>
      </kbd>
    </button>
  )
}
