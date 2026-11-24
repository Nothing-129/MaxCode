"use client"
import { useMemo, useSyncExternalStore } from "react"
import {
  useConnectionStore,
  type ConnectionStoreApi,
} from "@/contexts/acp-connections-context"
import { useDelegation } from "@/contexts/delegation-context"
import { useTabStore } from "@/stores/tab-store"
import type { DbConversationSummary } from "@/lib/types"
import {
  labConnectionSignal,
  preferLabSignal,
  type LabSignal,
} from "@/lib/conversation-lab-status"

export function useLabSignals(conversations: DbConversationSummary[]) {
  const store = useConnectionStore()
  const delegation = useDelegation()
  const tabs = useTabStore((s) => s.rawTabs)
  const sources = useMemo(() => {
    const byId = new Map(conversations.map((c) => [c.id, c]))
    const routes = new Map<string, { id: number; child: boolean }>()
    function add(key: string, id: number) {
      let c = byId.get(id)
      const seen = new Set<number>()
      while (c?.parent_id != null && !seen.has(c.id)) {
        seen.add(c.id)
        c = byId.get(c.parent_id)
      }
      if (c) routes.set(key, { id: c.id, child: c.id !== id })
    }
    for (const tab of tabs)
      if (tab.conversationId != null) add(tab.id, tab.conversationId)
    for (const c of conversations) {
      if (c.parent_id == null) continue
      const binding = delegation.findByChildConversationId(c.id)
      if (binding) add(binding.childConnectionId, c.id)
    }
    return routes
  }, [tabs, conversations, delegation])
  const projection = useMemo(
    () => createLabProjection(store, sources),
    [store, sources]
  )
  return useSyncExternalStore(
    projection.subscribe,
    projection.read,
    projection.read
  )
}

function createLabProjection(
  store: ConnectionStoreApi,
  sources: Map<string, { id: number; child: boolean }>
) {
  const signals = new Map<string, LabSignal>()
  let snapshot = new Map<number, LabSignal>()
  function refresh(key: string) {
    const route = sources.get(key)!
    let signal = labConnectionSignal(store.getConnection(key))
    if (!signal && store.getConnectPending(key)) signal = { kind: "preparing" }
    const error = store.getConnectError(key)
    if (!signal && error)
      signal = {
        kind: "failed",
        edge: JSON.stringify([key, error.title, error.detail]),
      }
    if (route.child) {
      if (signal?.kind === "approval" || signal?.kind === "input")
        signal = { ...signal, child: true }
      else signal = undefined
    }
    const old = signals.get(key)
    if (
      old?.kind === signal?.kind &&
      old?.edge === signal?.edge &&
      old?.startedAt === signal?.startedAt
    )
      return false
    if (signal) signals.set(key, signal)
    else signals.delete(key)
    let result: LabSignal | undefined
    for (const [source, value] of signals) {
      if (sources.get(source)?.id === route.id)
        result = preferLabSignal(result, value)
    }
    snapshot = new Map(snapshot)
    if (result) snapshot.set(route.id, result)
    else snapshot.delete(route.id)
    return true
  }
  for (const key of sources.keys()) refresh(key)
  return {
    read: () => snapshot,
    subscribe: (notify: () => void) => {
      const stops = Array.from(sources.keys(), (key) => {
        const sync = () => {
          if (refresh(key)) notify()
        }
        const stop = store.subscribeKey(key, sync)
        sync()
        return stop
      })
      return () => stops.forEach((stop) => stop())
    },
  }
}
