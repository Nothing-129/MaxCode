import { beforeEach, expect, it, vi } from "vitest"
import type { DbConversationSummary } from "@/lib/types"
import type { LabMark } from "@/lib/conversation-lab"
const wire = vi.hoisted(() => ({
  call: vi.fn(),
  event: null as null | ((value: unknown) => void),
  reconnect: null as null | (() => void),
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: wire.call }),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: async (_: string, cb: typeof wire.event) => {
    wire.event = cb
    return () => {}
  },
  onTransportReconnect: (cb: () => void) => {
    wire.reconnect = cb
    return () => {}
  },
}))
import { createLabSnoozeSync } from "@/lib/conversation-snooze-sync"
const c = { id: 7, created_at: "2026-11-25" } as DbConversationSummary
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
beforeEach(() => {
  wire.call.mockReset().mockResolvedValue([])
})
function client(initial?: LabMark) {
  let mark = initial
  const sync = createLabSnoozeSync({
    conversations: () => [c],
    mark: () => mark,
    apply: (_, next) => {
      mark = next
    },
  })
  return { sync, mark: () => mark }
}
it("restores snooze on a new device, reconciles reconnect, and ignores stale events", async () => {
  const mark = { until: Date.now() + 3600000, since: Date.now() }
  wire.call.mockResolvedValue([{ conversation_id: 7, mark, revision: 1 }])
  const device = client()
  const stop = device.sync.start()
  await settle()
  expect(device.mark()).toEqual(mark)
  wire.call.mockResolvedValue([
    { conversation_id: 7, mark: "woken", revision: 2 },
  ])
  wire.reconnect?.()
  await settle()
  expect(device.mark()).toBe("woken")
  wire.event?.({ conversation_id: 7, mark, revision: 1 })
  expect(device.mark()).toBe("woken")
  stop()
})
it("imports local snooze only when the backend has no saved state", async () => {
  const until = Date.now() + 3600000
  wire.call.mockImplementation(async (name, args) =>
    name === "get_conversation_snoozes"
      ? []
      : { conversation_id: 7, mark: args.mark, revision: 1 }
  )
  const device = client(until)
  const stop = device.sync.start()
  await settle()
  expect(wire.call).toHaveBeenCalledWith(
    "update_conversation_snooze",
    expect.objectContaining({
      conversation_id: 7,
      legacy: true,
      mark: expect.objectContaining({ until }),
    })
  )
  stop()
  wire.call
    .mockClear()
    .mockResolvedValue([{ conversation_id: 7, mark: null, revision: 3 }])
  const stale = client(until)
  const stopStale = stale.sync.start()
  await settle()
  expect(stale.mark()).toBeUndefined()
  expect(wire.call).not.toHaveBeenCalledWith(
    "update_conversation_snooze",
    expect.anything()
  )
  stopStale()
})
it("guards automatic wake and retains the mark when a save fails", async () => {
  const mark = { until: Date.now() + 3600000, since: Date.now() }
  wire.call.mockResolvedValue([{ conversation_id: 7, mark, revision: 4 }])
  const device = client()
  const stop = device.sync.start()
  await settle()
  wire.call.mockRejectedValueOnce(new Error("offline"))
  await expect(device.sync.save(c, undefined, true)).rejects.toThrow("offline")
  expect(device.mark()).toEqual(mark)
  expect(wire.call).toHaveBeenLastCalledWith("update_conversation_snooze", {
    conversation_id: 7,
    mark: null,
    expected_revision: 4,
  })
  stop()
})

it("shares a saved deadline and a later dismissal with a fresh client", async () => {
  let saved:
    | { conversation_id: number; mark: LabMark | null; revision: number }
    | undefined
  wire.call.mockImplementation(async (command: string, args) => {
    if (command === "get_conversation_snoozes") return saved ? [saved] : []
    saved = {
      conversation_id: args.conversation_id,
      mark: args.mark,
      revision: (saved?.revision ?? 0) + 1,
    }
    return saved
  })
  const desktop = client()
  const stopDesktop = desktop.sync.start()
  await settle()
  const mark = { until: Date.now() + 3600000, since: Date.now() }
  await desktop.sync.save(c, mark)
  stopDesktop()
  const phone = client()
  const stopPhone = phone.sync.start()
  await settle()
  expect(phone.mark()).toEqual(mark)
  await phone.sync.save(c, undefined)
  stopPhone()
  // Even a device with stale cached snooze data must respect the shared dismissal.
  const reopened = client(mark)
  const stopReopened = reopened.sync.start()
  await settle()
  expect(reopened.mark()).toBeUndefined()
  stopReopened()
})
