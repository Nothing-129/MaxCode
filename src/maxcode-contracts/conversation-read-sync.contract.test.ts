import { beforeEach, expect, it, vi } from "vitest"

const wire = vi.hoisted(() => ({
  call: vi.fn(),
  event: null as
    | null
    | ((value: {
        conversation_id: number
        receipt: string
        unread?: boolean
        revision?: number
      }) => void),
  reconnect: null as null | (() => void),
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: wire.call }),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: async (_event: string, callback: typeof wire.event) => {
    wire.event = callback
    return () => {}
  },
  onTransportReconnect: (callback: () => void) => {
    wire.reconnect = callback
    return () => {}
  },
}))
import { startConversationReadSync } from "@/lib/conversation-read-sync"
import {
  resetConversationUnreadStore,
  useConversationUnreadStore,
} from "@/stores/conversation-unread-store"

beforeEach(() => {
  localStorage.clear()
  resetConversationUnreadStore()
  wire.call.mockReset().mockResolvedValue([])
})
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

it("clears a desktop blue dot from a mobile receipt without echoing a write", async () => {
  const stop = startConversationReadSync()
  await settle()
  useConversationUnreadStore.getState().noteActivity(7)
  wire.event?.({ conversation_id: 7, receipt: "mobile-read" })
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(false)
  expect(wire.call).not.toHaveBeenCalledWith(
    "mark_conversations_read",
    expect.anything()
  )
  stop()
})

it("publishes opening a conversation even without a local unread dot", async () => {
  const stop = startConversationReadSync()
  await settle()
  useConversationUnreadStore.getState().setViewed([7])
  expect(wire.call).toHaveBeenCalledWith("mark_conversations_read", {
    ids: [7],
  })
  stop()
})

it("recovers missed reads on reconnect but never reapplies a seen receipt to new activity", async () => {
  const stop = startConversationReadSync()
  await settle()
  useConversationUnreadStore.getState().noteActivity(7)
  wire.call.mockResolvedValue([{ conversation_id: 7, receipt: "offline-read" }])
  wire.reconnect?.()
  await settle()
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(false)
  useConversationUnreadStore.getState().noteActivity(7)
  wire.reconnect?.()
  await settle()
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(true)
  stop()
  const stopAgain = startConversationReadSync()
  await settle()
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(true)
  stopAgain()
})

it("does not apply an older snapshot after a live receipt", async () => {
  let resolve!: (values: unknown[]) => void
  wire.call.mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const stop = startConversationReadSync()
  await settle()
  wire.event?.({ conversation_id: 7, receipt: "new" })
  useConversationUnreadStore.getState().noteActivity(7)
  resolve([{ conversation_id: 7, receipt: "old" }])
  await settle()
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(true)
  stop()
})

it("retries a failed mobile read when the connection returns", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
  const stop = startConversationReadSync()
  await settle()
  wire.call.mockImplementation(async (command: string) => {
    if (command === "mark_conversations_read") throw new Error("offline")
    return []
  })
  useConversationUnreadStore.getState().markRead(7)
  await settle()
  wire.call.mockClear().mockResolvedValue([])
  wire.reconnect?.()
  await settle()
  expect(wire.call).toHaveBeenCalledWith("mark_conversations_read", {
    ids: [7],
  })
  stop()
  warning.mockRestore()
})

it("shares mark-all-read while retaining local viewed tracking", async () => {
  const stop = startConversationReadSync()
  await settle()
  const state = useConversationUnreadStore.getState()
  state.setViewed([9])
  await settle()
  state.noteActivity(7)
  state.noteActivity(8)
  state.markAllRead()
  expect(wire.call).toHaveBeenCalledWith("mark_conversations_read", {
    ids: [7, 8],
  })
  expect([...useConversationUnreadStore.getState().viewedIds]).toEqual([9])
  stop()
})

it("loads a completion missed offline and treats server reads as authoritative", async () => {
  wire.call.mockResolvedValue([
    { conversation_id: 7, receipt: "turn-1", unread: true },
  ])
  const stop = startConversationReadSync()
  await settle()
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(true)
  wire.event?.({ conversation_id: 7, receipt: "read-1", unread: false })
  useConversationUnreadStore.getState().noteActivity(7)
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(false)
  stop()
})

it("acknowledges only the completion observed when opening the conversation", async () => {
  wire.call.mockResolvedValue([
    { conversation_id: 7, receipt: "turn-1", unread: true },
  ])
  const stop = startConversationReadSync()
  await settle()
  useConversationUnreadStore.getState().setViewed([7])
  expect(wire.call).toHaveBeenCalledWith("mark_conversations_read", {
    ids: [7],
    expected_receipts: { "7": "turn-1" },
  })
  stop()
})

it("waits for initial server state before acknowledging an already open conversation", async () => {
  let resolve!: (values: unknown[]) => void
  wire.call.mockImplementation((command: string) =>
    command === "get_conversation_reads"
      ? new Promise((done) => {
          resolve = done
        })
      : Promise.resolve([])
  )
  useConversationUnreadStore.getState().setViewed([7])
  const stop = startConversationReadSync()
  await settle()
  expect(wire.call).not.toHaveBeenCalledWith(
    "mark_conversations_read",
    expect.anything()
  )
  resolve([
    { conversation_id: 7, receipt: "new-turn", unread: true, revision: 2 },
  ])
  await settle()
  expect(wire.call).toHaveBeenCalledWith("mark_conversations_read", {
    ids: [7],
    expected_receipts: { "7": "new-turn" },
  })
  stop()
})

it("ignores an out-of-order read from an earlier execution", async () => {
  const stop = startConversationReadSync()
  await settle()
  wire.event?.({
    conversation_id: 7,
    receipt: "new-turn",
    unread: true,
    revision: 3,
  })
  wire.event?.({
    conversation_id: 7,
    receipt: "old-read",
    unread: false,
    revision: 2,
  })
  expect(useConversationUnreadStore.getState().unreadIds.has(7)).toBe(true)
  stop()
})
