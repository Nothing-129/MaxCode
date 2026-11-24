import { cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import zh from "@/i18n/messages/zh-CN.json"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("MaxCode: live status shows the phase and total elapsed time", () => {
  it.each([
    ["waiting", "处理中"],
    ["thinking", "思考中"],
    ["text", "输出中"],
  ] as const)(
    "shows the %s phase and unadorned elapsed time",
    (phase, label) => {
      vi.spyOn(Date, "now").mockReturnValue(185_000)
      const content: LiveMessage["content"] =
        phase === "waiting" ? [] : [{ type: phase, text: "内容" }]
      const { container } = render(
        <NextIntlClientProvider locale="zh-CN" messages={zh}>
          <LiveTurnStats
            message={{
              id: "original",
              role: "assistant",
              startedAt: 0,
              content,
            }}
          />
        </NextIntlClientProvider>
      )
      const status = screen.getByRole("status")
      const elapsed = screen.getByText("3 分 5 秒")
      expect(status).toHaveTextContent(label)
      expect(elapsed).toBeVisible()
      expect(container.querySelector(".lucide-timer")).toBeNull()
      expect(status).not.toHaveTextContent("3 分")
      expect(container).not.toHaveTextContent("tok/s")
      expect(container).not.toHaveTextContent("|")
      const dot = screen.getByText("·")
      expect(dot).toHaveAttribute("aria-hidden", "true")
      expect(dot.previousElementSibling).toBe(status)
      expect(dot.nextElementSibling).toBe(elapsed)
    }
  )

  it("ends with elapsed time when a tool modifies files", () => {
    const message: LiveMessage = {
      id: "edit-turn",
      role: "assistant",
      startedAt: Date.now(),
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "write-1",
            title: "Write",
            kind: "write",
            status: "in_progress",
            raw_input: JSON.stringify({
              file_path: "/repo/a.ts",
              content: "one\ntwo",
            }),
            content: null,
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
      ],
    }
    const { container } = render(
      <NextIntlClientProvider locale="zh-CN" messages={zh}>
        <LiveTurnStats message={message} />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole("status")).toHaveTextContent("执行中")
    expect(screen.getByText("0 秒")).toBeVisible()
    expect(container.textContent).not.toMatch(/\d+F\s*\+|\+2\/-0/)
    expect(container.querySelector(".lucide-file-pen-line")).toBeNull()
    expect(screen.getByRole("status").parentElement?.lastElementChild).toBe(
      screen.getByText("0 秒")
    )
  })
})
