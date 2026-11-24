"use client"
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import { toErrorMessage } from "@/lib/app-error"
import { updateLabSettlement } from "@/lib/api"
import { createStore, useStore } from "zustand"
import { useLabSignals } from "./use-lab-signals"
import { shouldWakeLabSnooze } from "@/lib/conversation-lab-status"
import {
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
  return createStore<{
    marks: Map<string, LabMark>
    seenFailures: Map<string, string>
    change: (
      c: DbConversationSummary,
      mark?: LabMark,
      previousEdge?: string
    ) => void
    seeFailure: (key: string, edge: string) => void
  }>()((set, get) => ({
    marks: loadLabMarks(),
    seenFailures: loadSeenFailures(),
    async change(
      c: DbConversationSummary,
      mark?: LabMark,
      previousEdge?: string
    ) {
      const key = labKey(c)
      const settledAt = labSettledAt(mark)
      const previous = get().marks.get(key)
      if (
        settledAt ||
        c.lab_settled_at ||
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
        if (mark === undefined) localStorage.removeItem(key)
        else
          localStorage.setItem(
            key,
            typeof mark === "object"
              ? "until" in mark
                ? JSON.stringify(mark)
                : "finished:" + mark.settledAt
              : mark
          )
      } catch {}
      const marks = new Map(get().marks)
      if (mark === undefined) marks.delete(key)
      else marks.set(key, mark)
      set({ marks })
    },
    seeFailure(key: string, edge: string) {
      const seenFailures = new Map(get().seenFailures).set(key, edge)
      try {
        localStorage.setItem(seenKey, JSON.stringify([...seenFailures]))
      } catch {}
      set({ seenFailures })
    },
  }))
}

function useLabController() {
  const conversations = useAppWorkspaceStore((s) => s.conversations)
  const [clock, tick] = useState(0)
  const [store] = useState(createLabMarksStore)
  const { marks, seenFailures, change, seeFailure } = useStore(store)
  const signals = useLabSignals(conversations)
  const viewed = useConversationUnreadStore((s) => s.viewedIds)
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
        store.setState({ marks: loadLabMarks() })
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
      if (c.lab_settled_at) continue
      const key = labKey(c)
      const signal = signals.get(c.id)
      const mark = marks.get(key)
      const until = labSnoozeUntil(mark)
      if (until != null && until > now && signal?.edge) {
        const snooze =
          typeof mark === "object" && "until" in mark ? mark : undefined
        if (shouldWakeLabSnooze(signal, snooze?.previousEdge, snooze?.since))
          change(c, viewed.has(c.id) ? undefined : "woken")
      }
      if (viewed.has(c.id)) {
        if (labHasWoken(mark, now)) change(c)
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

const Context = createContext<ReturnType<typeof useLabController> | null>(null)
export function ConversationLabProvider({ children }: { children: ReactNode }) {
  const value = useLabController()
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useLabState() {
  const value = useContext(Context)
  if (!value)
    throw new Error("ConversationLab requires ConversationLabProvider")
  return value
}
