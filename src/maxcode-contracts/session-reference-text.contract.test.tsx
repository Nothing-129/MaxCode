import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MessageResponse } from "@/components/ai-elements/message"

vi.mock("@/components/ai-elements/link-safety", () => ({
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))

describe("Session references in assistant replies", () => {
  it.each(["123", "codex_abc"])(
    "displays %s as plain inline text",
    async (id) => {
      const { container } = render(
        <MessageResponse>
          {`找到历史对话 [打开「目标与分配」](codeg://session/${id})。`}
        </MessageResponse>
      )

      const label = await screen.findByText("打开「目标与分配」")
      expect(container).toHaveTextContent("找到历史对话 打开「目标与分配」。")
      expect(label.closest("[data-reference-badge]")).toBeNull()
      expect(label.closest("a, button, [role='link'], [tabindex]")).toBeNull()
      expect(container.querySelector("svg")).toBeNull()
    }
  )
})
