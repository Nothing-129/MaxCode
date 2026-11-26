"use client"
import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { toErrorMessage } from "@/lib/app-error"
import { updateLabSettlement } from "@/lib/api"
import { createLabSnoozeSync } from "@/lib/conversation-snooze-sync"
import { createStore, useStore } from "zustand"
import { ConversationLabContext as Context } from "./conversation-lab-context"
import { CustomSnooze } from "./conversation-lab-snooze"
import { useLabSignals } from "./use-lab-signals"
import { shouldWakeLabSnooze } from "@/lib/conversation-lab-status"
import {
  isConversationSettled,
  labKey,
  labSettledAt,
  labHasWoken,
  labSnoozeUntil,
  loadLabMarks,
  type LabMark,
} from "@/lib/conversation-lab"
import type { DbConversationSummary } from "@/lib/types"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"

const seenKey = "maxcode:lab-seen-failures"

function loadSeenFailures(): Map<string, string> {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(seenKey) ?? "[]")
    return new Map(
      Array.isArray(entries)
        ? entries.filter(
            (pair) =>
              Array.isArray(pair) &&
              pair.length === 2 &&
              pair.every((s) => typeof s === "string")
          )
        : []
    )
  } catch {
    return new Map()
  }
}

function createLabMarksStore() {
  const hydratedKeys = new Set<string>()
  const sync = createLabSnoozeSync({
    conversations: () => useAppWorkspaceStore.getState().conversations,
    mark: (c) => store.getState().marks.get(labKey(c)),
    apply: (c, mark) => {
      const key = labKey(c)
      const previous = store.getState().marks.get(key)
      const hydrated = hydratedKeys.has(key)
      hydratedKeys.add(key)
      if (hydrated && JSON.stringify(previous) === JSON.stringify(mark)) return
      // Legacy settlement migration owns these entries until it succeeds.
      if (
        mark === undefined &&
        (previous === "finished" || labSettledAt(previous))
      )
        return
      try {
        if (mark === undefined) localStorage.removeItem(key)
        else
          localStorage.setItem(
            key,
            typeof mark === "string" ? mark : JSON.stringify(mark)
          )
      } catch {}
      const marks = new Map(store.getState().marks)
      if (mark === undefined) marks.delete(key)
      else marks.set(key, mark)
      store.setState({ marks })
    },
  })
  const store = createStore<{
    startSync: () => () => void
    refresh: () => Promise<void>
    marks: Map<string, LabMark>
    seenFailures: Map<string, string>
    change: (
      c: DbConversationSummary,
      mark?: LabMark,
      previousEdge?: string,
      automatic?: boolean
    ) => void
    seeFailure: (key: string, edge: string) => void
  }>()((set, get) => ({
    startSync: sync.start,
    refresh: sync.refresh,
    marks: loadLabMarks(),
    seenFailures: loadSeenFailures(),
    async change(
      c: DbConversationSummary,
      mark?: LabMark,
      previousEdge?: string,
      automatic = false
    ) {
      const key = labKey(c)
      const settledAt = labSettledAt(mark)
      const previous = get().marks.get(key)
      if (
        settledAt ||
        isConversationSettled(c) ||
        previous === "finished" ||
        labSettledAt(previous)
      ) {
        try {
          await updateLabSettlement(c.id, settledAt ?? 0)
        } catch (error) {
          toast.error(toErrorMessage(error))
          return
        }
        if (settledAt) mark = undefined
      }
      if (typeof mark === "number")
        mark = { until: mark, since: Date.now(), previousEdge }
      try {
        await sync.save(c, mark, automatic)
      } catch (error) {
        toast.error(toErrorMessage(error))
      }
    },
    seeFailure(key: string, edge: string) {
      const seenFailures = new Map(get().seenFailures).set(key, edge)
      try {
        localStorage.setItem(seenKey, JSON.stringify([...seenFailures]))
      } catch {}
      set({ seenFailures })
    },
  }))
  return store
}

function useLabController() {
  const conversations = useAppWorkspaceStore((s) => s.conversations)
  const [clock, tick] = useState(0)
  const [store] = useState(createLabMarksStore)
  const { marks, seenFailures, change, seeFailure } = useStore(store)
  const signals = useLabSignals(conversations)
  const viewed = useConversationUnreadStore((s) => s.viewedIds)
  useEffect(() => store.getState().startSync(), [store])
  useEffect(() => {
    void store.getState().refresh()
  }, [conversations, store])
  useEffect(() => {
    let active = true
    async function migrate() {
      for (const c of conversations) {
        const key = labKey(c)
        const mark = store.getState().marks.get(key)
        if (!active) return
        if (mark !== "finished" && labSettledAt(mark) === undefined) continue
        try {
          if (c.lab_settled_at == null)
            await updateLabSettlement(
              c.id,
              labSettledAt(mark) ?? (Date.parse(c.updated_at) || 1),
              true
            )
          if (store.getState().marks.get(key) !== mark) continue
          localStorage.removeItem(key)
          const remaining = new Map(store.getState().marks)
          remaining.delete(key)
          store.setState({ marks: remaining })
        } catch {
          // Preserve the legacy entry for the next connection or focus.
        }
      }
    }
    void migrate()
    window.addEventListener("focus", migrate)
    return () => {
      active = false
      window.removeEventListener("focus", migrate)
    }
  }, [conversations, store])
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("maxcode:conversation-lab:"))
        void store.getState().refresh()
      if (!e.key || e.key === seenKey)
        store.setState({ seenFailures: loadSeenFailures() })
    }
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [store])
  useEffect(() => {
    const now = Date.now()
    let nextViewedWake = Infinity
    for (const c of conversations) {
      // A local snooze timer must never undo a settlement from another device.
      if (isConversationSettled(c)) continue
      const key = labKey(c)
      const signal = signals.get(c.id)
      const mark = marks.get(key)
      const until = labSnoozeUntil(mark)
      if (until != null && until > now && signal?.edge) {
        const snooze =
          typeof mark === "object" && "until" in mark ? mark : undefined
        if (shouldWakeLabSnooze(signal, snooze?.previousEdge, snooze?.since))
          change(c, viewed.has(c.id) ? undefined : "woken", undefined, true)
      }
      if (viewed.has(c.id)) {
        if (labHasWoken(mark, now)) change(c, undefined, undefined, true)
        else if (until != null) nextViewedWake = Math.min(nextViewedWake, until)
      }
      if (
        signal?.kind === "failed" &&
        signal.runFailure &&
        signal.edge &&
        viewed.has(c.id) &&
        seenFailures.get(key) !== signal.edge
      ) {
        seeFailure(key, signal.edge)
      }
    }
    if (Number.isFinite(nextViewedWake)) {
      const timer = setTimeout(
        () => tick((value) => value + 1),
        Math.min(nextViewedWake - now, 2147483647)
      )
      return () => clearTimeout(timer)
    }
  }, [
    conversations,
    signals,
    marks,
    clock,
    viewed,
    seenFailures,
    change,
    seeFailure,
  ])
  return { marks, signals, seenFailures, change }
}

type CustomSnoozeHandler = (at: number) => void
export type ConversationLabState = ReturnType<typeof useLabController> & {
  customSnooze: (handler: CustomSnoozeHandler) => void
}

export function ConversationLabProvider({ children }: { children: ReactNode }) {
  const state = useLabController()
  const [custom, setCustom] = useState<CustomSnoozeHandler | null>(null)
  function customSnooze(handler: CustomSnoozeHandler) {
    setCustom(() => handler)
  }
  return (
    <Context.Provider value={{ ...state, customSnooze }}>
      {children}
      {custom && <CustomSnooze snooze={custom} close={() => setCustom(null)} />}
    </Context.Provider>
  )
}
export { useLabState } from "./conversation-lab-context"
