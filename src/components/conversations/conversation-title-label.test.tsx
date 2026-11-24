import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationTitleLabel } from "./conversation-title-label"

describe("ConversationTitleLabel", () => {
  it.each(["1124｜自动｜项目分析", "1124｜项目分析"])(
    "shows only the topic for %s",
    (title) => {
      const { container } = render(
        <ConversationTitleLabel title={title} fallback="Untitled" />
      )
      expect(container.textContent).toBe("项目分析")
    }
  )

  it("keeps unstructured titles as one truncated string", () => {
    const { getByText } = render(
      <ConversationTitleLabel
        title="检查文字粗细差异"
        fallback="Untitled"
        className="maxcode-sidebar-label font-[430]"
      />
    )
    const title = getByText("检查文字粗细差异")
    expect(title).toHaveClass("truncate", "maxcode-sidebar-label", "font-[430]")
    expect(title.querySelector("[class*='tabular-nums']")).toBeNull()
  })

  it("uses the fallback when the title is empty", () => {
    const { getByText } = render(
      <ConversationTitleLabel title={null} fallback="Untitled conversation" />
    )
    expect(getByText("Untitled conversation")).toHaveClass("truncate")
  })
})
