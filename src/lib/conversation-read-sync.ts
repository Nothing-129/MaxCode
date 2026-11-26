import { getTransport } from "@/lib/transport"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import { conversationUnreadStorageKey } from "@/lib/conversation-unread-storage"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"

interface ReadReceipt {
  conversation_id: number
  receipt: string
  revision?: number
  unread?: boolean
}

const readListeners = new Set<(ids: number[]) => void>()

/** A read is meaningful even when this device has no local blue dot. */
export function publishConversationRead(ids: number[]): void {
  if (ids.length) for (const listener of readListeners) listener(ids)
}

export function startConversationReadSync(): () => void {
  const transport = getTransport()
  const key = `${conversationUnreadStorageKey()}:receipts`
  let receipts: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}")
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      receipts = parsed as Record<string, string>
    }
  } catch {}
  let disposed = false
  let generation = 0
  const changed = new Map<number, number>()
  const pending = new Map<number, string | undefined>()
  const authoritative = new Set<number>()
  const revisions = new Map<number, number>()
  let sending = false
  let hydrated = false
  const apply = (value: ReadReceipt) => {
    if (disposed) return
    if (value.revision !== undefined) {
      if (value.revision < (revisions.get(value.conversation_id) ?? -1)) return
      revisions.set(value.conversation_id, value.revision)
    }
    const same = receipts[value.conversation_id] === value.receipt
    if (same && value.unread === undefined) return
    changed.set(value.conversation_id, ++generation)
    receipts[value.conversation_id] = value.receipt
    if (value.unread !== undefined) {
      authoritative.add(value.conversation_id)
      useConversationUnreadStore
        .getState()
        .applyRemoteState(value.conversation_id, value.unread)
    } else {
      useConversationUnreadStore
        .getState()
        .applyRemoteRead(value.conversation_id)
    }
    try {
      localStorage.setItem(key, JSON.stringify(receipts))
    } catch {}
  }
  const refresh = async () => {
    const started = generation
    try {
      const values = await transport.call<ReadReceipt[]>(
        "get_conversation_reads"
      )
      for (const value of values) {
        if ((changed.get(value.conversation_id) ?? 0) <= started) apply(value)
      }
      if (!hydrated) {
        hydrated = true
        pending.forEach((token, id) => {
          if (token === undefined && authoritative.has(id))
            pending.set(id, receipts[id])
        })
        publish([...useConversationUnreadStore.getState().viewedIds])
      }
      void flush()
    } catch (error) {
      console.warn("[ConversationUnread] read receipt refresh failed", error)
    }
  }
  const flush = async () => {
    if (disposed || !hydrated || sending || pending.size === 0) return
    sending = true
    // Never let a legacy request remove the guard from a modern receipt.
    const guarded = [...pending.values()].some((token) => token !== undefined)
    const batch = new Map(
      [...pending].filter(([, token]) => (token !== undefined) === guarded)
    )
    const ids = [...batch.keys()]
    ids.forEach((id) => pending.delete(id))
    try {
      // The broadcast is authoritative. Do not replay a potentially older
      // HTTP response over a newer event from another client.
      await transport.call("mark_conversations_read", {
        ids,
        ...(ids.every((id) => batch.get(id) !== undefined)
          ? { expected_receipts: Object.fromEntries(batch) }
          : {}),
      })
    } catch (error) {
      batch.forEach((receipt, id) => {
        if (!pending.has(id)) pending.set(id, receipt)
      })
      console.warn("[ConversationUnread] read receipt save failed", error)
      return
    } finally {
      sending = false
    }
    if (!disposed && pending.size) void flush()
  }
  const publish = (ids: number[]) => {
    ids.forEach((id) =>
      pending.set(id, authoritative.has(id) ? receipts[id] : undefined)
    )
    void flush()
  }
  readListeners.add(publish)
  let unlisten: (() => void) | undefined
  void subscribe<ReadReceipt>("conversation-read://changed", apply)
    .then((dispose) => {
      if (disposed) return dispose()
      unlisten = dispose
      void refresh()
    })
    .catch((error) =>
      console.warn("[ConversationUnread] subscription failed", error)
    )
  const recover = () => {
    void refresh()
    void flush()
  }
  const reconnect = onTransportReconnect(recover)
  const wake = () => {
    if (document.visibilityState === "visible") recover()
  }
  window.addEventListener("focus", recover)
  document.addEventListener("visibilitychange", wake)
  return () => {
    disposed = true
    readListeners.delete(publish)
    unlisten?.()
    reconnect?.()
    window.removeEventListener("focus", recover)
    document.removeEventListener("visibilitychange", wake)
  }
}
