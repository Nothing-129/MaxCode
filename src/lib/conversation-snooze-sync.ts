import { getTransport } from "@/lib/transport"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import type { DbConversationSummary } from "@/lib/types"
import type { LabMark } from "@/lib/conversation-lab"

type SnoozeMark = Exclude<LabMark, "finished" | { settledAt: number } | number>
interface SnoozeState {
  conversation_id: number
  mark: SnoozeMark | null
  revision: number
}
function snoozeMark(mark?: LabMark): SnoozeMark | null {
  if (typeof mark === "number") return { until: mark, since: Date.now() }
  return mark === "woken" || (typeof mark === "object" && "until" in mark)
    ? mark
    : null
}

/** Durable server state; local marks are imported once, never used over a tombstone. */
export function createLabSnoozeSync(options: {
  conversations: () => DbConversationSummary[]
  mark: (c: DbConversationSummary) => LabMark | undefined
  apply: (c: DbConversationSummary, mark: LabMark | undefined) => void
}) {
  const states = new Map<number, SnoozeState>()
  const apply = (state: SnoozeState) => {
    if (state.revision < (states.get(state.conversation_id)?.revision ?? -1))
      return
    states.set(state.conversation_id, state)
    const c = options
      .conversations()
      .find((c) => c.id === state.conversation_id)
    if (c) options.apply(c, state.mark ?? undefined)
  }
  const save = async (
    c: DbConversationSummary,
    mark?: LabMark,
    automatic = false
  ) => {
    // Timers cannot write until this device has observed the current revision.
    if (automatic && !states.has(c.id)) return
    const value = await getTransport().call<SnoozeState>(
      "update_conversation_snooze",
      {
        conversation_id: c.id,
        mark: snoozeMark(mark),
        ...(automatic ? { expected_revision: states.get(c.id)!.revision } : {}),
      }
    )
    apply(value)
  }
  let stopped = false
  let refreshing = false
  let refreshAgain = false
  const refresh = async () => {
    if (stopped) return
    if (refreshing) {
      refreshAgain = true
      return
    }
    refreshing = true
    try {
      const values = await getTransport().call<SnoozeState[]>(
        "get_conversation_snoozes"
      )
      if (stopped) return
      values.forEach(apply)
      for (const c of options.conversations()) {
        const known = states.get(c.id)
        if (known) {
          apply(known)
          continue
        }
        const mark = snoozeMark(options.mark(c))
        if (mark) {
          const imported = await getTransport().call<SnoozeState>(
            "update_conversation_snooze",
            {
              conversation_id: c.id,
              mark,
              legacy: true,
            }
          )
          if (stopped) return
          apply(imported)
        } else {
          // Retain old settlement marks for their separate migration.
          states.set(c.id, { conversation_id: c.id, mark: null, revision: 0 })
        }
      }
    } catch (error) {
      console.warn("[ConversationSnooze] sync failed", error)
    } finally {
      refreshing = false
      if (refreshAgain && !stopped) {
        refreshAgain = false
        void refresh()
      }
    }
  }
  const start = () => {
    stopped = false
    let active = true
    let unlisten: (() => void) | undefined
    void subscribe<SnoozeState>("conversation-snooze://changed", (state) => {
      if (active) apply(state)
    })
      .then((dispose) => {
        if (!active) return dispose()
        unlisten = dispose
        void refresh()
      })
      .catch((error) =>
        console.warn("[ConversationSnooze] subscribe failed", error)
      )
    const recover = () => {
      void refresh()
    }
    const reconnect = onTransportReconnect(recover)
    const visible = () => {
      if (document.visibilityState === "visible") recover()
    }
    window.addEventListener("focus", recover)
    document.addEventListener("visibilitychange", visible)
    return () => {
      stopped = true
      active = false
      unlisten?.()
      reconnect?.()
      window.removeEventListener("focus", recover)
      document.removeEventListener("visibilitychange", visible)
    }
  }
  return { start, refresh, save }
}
