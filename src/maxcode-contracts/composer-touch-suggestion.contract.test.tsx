import { createRef } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AcceptPromptSuggestion } from "@/components/chat/composer/accept-prompt-suggestion"
import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"

afterEach(cleanup)

describe("desktop and touch composer suggestion adoption", () => {
  function mount(empty = true) {
    const editorRef = createRef<RichComposerHandle>()
    const setText = vi.fn()
    const focus = vi.fn()
    const isEmpty = vi.fn(() => empty)
    editorRef.current = {
      setText,
      focus,
      isEmpty,
    } as unknown as RichComposerHandle
    render(
      <AcceptPromptSuggestion
        editorRef={editorRef}
        suggestion="  允许，继续查  "
        label="采纳建议"
      />
    )
    return { setText, focus, isEmpty }
  }

  it("requires a separate click and fills the editor without submitting", () => {
    const { setText, focus } = mount()
    const button = screen.getByRole("button", { name: "采纳建议" })
    expect(button).toHaveAttribute("type", "button")
    expect(setText).not.toHaveBeenCalled()
    expect(button.querySelector("kbd")).toHaveClass("text-muted-foreground")
    expect(button).toHaveTextContent("Tab")
    fireEvent.click(button)
    expect(setText).toHaveBeenCalledWith("允许，继续查")
    expect(focus).toHaveBeenCalledOnce()
  })

  it("rechecks the live document so a late tap cannot overwrite typing", () => {
    const { setText, focus, isEmpty } = mount()
    isEmpty.mockReturnValue(false)
    fireEvent.click(screen.getByRole("button", { name: "采纳建议" }))
    expect(setText).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })

  it("renders the entire long preview inside the scroll area until the user enters text", async () => {
    const editorRef = createRef<RichComposerHandle>()
    const suggestion =
      "请先整理这次讨论里的待办事项，再按负责人列出每一项，并标出还需要确认的细节。"
    const { container } = render(
      <RichComposer
        ref={editorRef}
        placeholder={suggestion}
        promptSuggestion={suggestion}
        ariaLabel="消息"
      />
    )

    const preview = await screen.findByText(suggestion)
    expect(container.querySelector(".codeg-composer-scroll")).toContainElement(
      preview
    )
    expect(screen.getByRole("textbox", { name: "消息" })).toHaveTextContent("")
    expect(editorRef.current?.getText()).toBe("")

    act(() => editorRef.current?.setText("我的草稿"))
    expect(screen.queryByText(suggestion)).not.toBeInTheDocument()
    expect(editorRef.current?.getText()).toBe("我的草稿")
  })

  it("uses the T3 outline key and literal label on all devices", () => {
    mount()
    const button = screen.getByRole("button", { name: "采纳建议" })
    expect(button).toHaveClass("ml-2", "align-[1px]")
    const key = button.querySelector("kbd")
    expect(key?.textContent?.trim()).toBe("⇥ Tab")
    expect(key).not.toHaveClass("border-b-2")
    expect(key?.firstElementChild).toHaveClass("top-[0.5px]")
    expect(key).toHaveClass(
      "h-5",
      "min-w-5",
      "font-medium",
      "text-xs",
      "px-1.5",
      "border",
      "border-foreground/10"
    )
  })
})
