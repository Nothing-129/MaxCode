import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"
import zh from "@/i18n/messages/zh-CN.json"

const startedAt = Date.now()

function tool(
  status: "in_progress" | "completed",
  meta: Record<string, unknown> | null = null
): LiveContentBlock {
  return {
    type: "tool_call",
    info: {
      tool_call_id: "tool-1",
      title: "Read",
      kind: "read",
      status,
      content: null,
      raw_input: null,
      raw_output_chunks: [],
      raw_output_total_bytes: 0,
      locations: null,
      meta,
      images: [],
    },
  }
}

function view(
  content: LiveContentBlock[],
  props: {
    awaitingUser?: boolean
    isStreaming?: boolean
    retrying?: boolean
  } = {}
) {
  const message: LiveMessage = {
    id: "turn-1",
    role: "assistant",
    startedAt,
    content,
  }
  return (
    <NextIntlClientProvider locale="zh-CN" messages={zh}>
      <LiveTurnStats message={message} {...props} />
    </NextIntlClientProvider>
  )
}

describe("MaxCode: live turn activity orb", () => {
  it("replaces the agent icon in the bottom status row throughout the turn", () => {
    const { rerender } = render(view([]))
    const status = screen.getByRole("status")
    const orb = status.previousElementSibling
    expect(orb?.tagName).toBe("CANVAS")
    expect(orb).toHaveStyle({ width: "16px", height: "16px" })
    expect(orb).toHaveAttribute("aria-hidden", "true")
    expect(orb?.previousElementSibling).toBeNull()
    expect(status).toHaveTextContent("处理中")
    expect(orb).toHaveAttribute("data-orb-state", "breathing")

    for (const [next, state] of [
      [view([{ type: "thinking", text: "检查上下文" }]), "solving"],
      [view([tool("in_progress")]), "connecting"],
      [
        view([tool("in_progress", { contextCompaction: { version: 1 } })]),
        "weaving",
      ],
      [view([{ type: "text", text: "正在回答" }]), "composing"],
      [view([tool("completed")]), "breathing"],
      [view([], { retrying: true }), "working"],
      [view([tool("in_progress")], { awaitingUser: true }), "breathing"],
    ] as const) {
      rerender(next)
      expect(screen.getByRole("status").previousElementSibling).toBe(orb)
      expect(orb).toHaveAttribute("data-orb-state", state)
    }

    rerender(view([], { isStreaming: false }))
    const completed = screen.getByRole("status")
    expect(completed).toHaveTextContent("响应已结束")
    expect(completed.previousElementSibling).toBe(orb)
    expect(orb).toHaveAttribute("data-orb-state", "shaping")
  })
})
