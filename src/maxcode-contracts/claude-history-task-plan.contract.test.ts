import { describe, expect, it } from "vitest"
import type {
  AdaptedContentPart,
  AdaptedMessage,
} from "@/lib/adapters/ai-elements-adapter"
import { extractLatestPlanEntriesFromMessages } from "@/lib/agent-plan"

function call(
  toolName: string,
  input: Record<string, string>,
  output: string
): Extract<AdaptedContentPart, { type: "tool-call" }> {
  return {
    type: "tool-call",
    toolCallId: toolName,
    toolName,
    input: JSON.stringify(input),
    output,
    state: "output-available",
  }
}

const message = (content: AdaptedContentPart[]): AdaptedMessage => ({
  id: "claude-history",
  role: "assistant",
  timestamp: "2026-11-20T00:00:00Z",
  content,
})

describe("Claude's checklist after reopening history", () => {
  it("replays grouped tasks in order and ignores unconfirmed updates", () => {
    const items = [
      call(
        "TaskCreate",
        { subject: "Run tests" },
        "Task #1 created successfully: Run tests"
      ),
      call(
        "TaskUpdate",
        { taskId: "1", status: "in_progress", activeForm: "Running tests" },
        "Updated task #1 status"
      ),
      call(
        "TaskUpdate",
        { taskId: "1", status: "completed" },
        "Task #1 not found"
      ),
    ]
    expect(
      extractLatestPlanEntriesFromMessages([
        message([{ type: "tool-group", items, isStreaming: false }]),
      ])
    ).toEqual([
      { content: "Running tests", status: "in_progress", priority: "medium" },
    ])
  })

  it("uses a confirmed update when the creation lies beyond the loaded history", () => {
    expect(
      extractLatestPlanEntriesFromMessages([
        message([
          call(
            "TaskUpdate",
            { taskId: "9", status: "pending", subject: "Check logs" },
            "Updated task #9 status"
          ),
        ]),
      ])
    ).toEqual([
      { content: "Check logs", status: "pending", priority: "medium" },
    ])
  })
})
