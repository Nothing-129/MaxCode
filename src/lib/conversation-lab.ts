import type { LabSignal } from "./conversation-lab-status"
import type { DbConversationSummary } from "@/lib/types"
import { isRunningConversationStatus } from "@/lib/conversation-unread"

export const labGroups = [
  "pinned",
  "main",
  "running",
  "snoozed",
  "finished",
] as const
export type LabGroup = (typeof labGroups)[number]
interface LabSnooze {
  until: number
  since: number
  previousEdge?: string
}
export type LabMark =
  | "finished"
  | "woken"
  | { settledAt: number }
  | LabSnooze
  | number
export function labSnoozeUntil(mark?: LabMark) {
  return typeof mark === "number"
    ? mark
    : typeof mark === "object" && "until" in mark
      ? mark.until
      : undefined
}
export function labSettledAt(mark?: LabMark) {
  return typeof mark === "object" && "settledAt" in mark
    ? mark.settledAt
    : undefined
}
const prefix = "maxcode:conversation-lab:"

export function labKey(c: DbConversationSummary) {
  return prefix + c.id + ":" + c.created_at
}

export function isConversationSettled(
  c: Pick<DbConversationSummary, "status" | "lab_settled_at">
) {
  return c.lab_settled_at === undefined
    ? c.status === "completed"
    : (c.lab_settled_at ?? 0) > 0
}

export function conversationDisplayStatus(
  c: Pick<DbConversationSummary, "status" | "lab_settled_at" | "parent_id">
) {
  if (c.parent_id != null) return c.status
  if (isConversationSettled(c)) return "completed"
  return c.status === "completed" ? "pending_review" : c.status
}

export function labGroup(
  c: DbConversationSummary,
  mark: LabMark | undefined,
  now: number,
  signal?: LabSignal
): LabGroup {
  if (
    isConversationSettled(c) ||
    (c.lab_settled_at == null &&
      (mark === "finished" || labSettledAt(mark) !== undefined))
  )
    return "finished"
  if ((labSnoozeUntil(mark) ?? 0) > now) return "snoozed"
  if (c.pinned_at) return "pinned"
  if (signal) {
    return signal.kind === "working" ||
      signal.kind === "goal" ||
      signal.kind === "waiting"
      ? "running"
      : "main"
  }
  if (isRunningConversationStatus(c.status)) return "running"
  return "main"
}

export function labHasWoken(mark: LabMark | undefined, now: number) {
  return mark === "woken" || (labSnoozeUntil(mark) ?? Infinity) <= now
}

export function loadLabMarks(): Map<string, LabMark> {
  const marks = new Map<string, LabMark>()
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue
      const value = localStorage.getItem(key)
      if (value === "finished" || value === "woken") marks.set(key, value)
      else if (value?.startsWith("finished:")) {
        const settledAt = Number(value.slice("finished:".length))
        if (Number.isFinite(settledAt) && settledAt > 0)
          marks.set(key, { settledAt })
      } else if (value?.startsWith("{")) {
        try {
          const parsed = JSON.parse(value)
          if (
            Number.isFinite(parsed?.until) &&
            parsed.until > 0 &&
            Number.isFinite(parsed.since)
          )
            marks.set(key, parsed)
        } catch {
          /* Ignore malformed entries independently. */
        }
      } else if (Number.isFinite(Number(value)) && Number(value) > 0)
        marks.set(key, Number(value))
    }
  } catch {
    /* Storage can be unavailable in a private browser. */
  }
  return marks
}

const hour = 3_600_000

export function snoozePresets(now: number) {
  const dayAt = (days: number, hours: number) => {
    // Beijing time is UTC+08:00; use UTC setters to ignore the device timezone.
    const date = new Date(now + 8 * hour)
    date.setUTCDate(date.getUTCDate() + days)
    return date.setUTCHours(hours, 0, 0, 0) - 8 * hour
  }
  const monday = (8 - new Date(now + 8 * hour).getUTCDay()) % 7 || 7
  const choices = [
    { key: "oneHour", at: now + hour },
    { key: "threeHours", at: now + 3 * hour },
    { key: "tonight", at: dayAt(0, 18) },
    { key: "tomorrow", at: dayAt(1, 9) },
    { key: "nextWeek", at: dayAt(monday, 9) },
  ] as const
  const seen = new Set<number>()
  return [...choices]
    .sort((a, b) => a.at - b.at)
    .filter(({ at }) => {
      const minute = Math.floor(at / 60_000)
      if (at <= now || seen.has(minute)) return false
      seen.add(minute)
      return true
    })
}

function formatLabUnit(
  amount: number,
  unit: string,
  locale: string,
  minimumIntegerDigits = 1
) {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "narrow",
    minimumIntegerDigits,
  }).format(amount)
}

export function formatLabWorkingDuration(delta: number, locale: string) {
  const seconds = Number.isFinite(delta)
    ? Math.max(0, Math.floor(delta / 1000))
    : 0
  if (seconds < 60) return formatLabUnit(seconds, "second", locale)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const minutesAndSeconds = `${formatLabUnit(minutes, "minute", locale)} ${formatLabUnit(seconds % 60, "second", locale, 2)}`
  return hours
    ? `${formatLabUnit(hours, "hour", locale)} ${minutesAndSeconds}`
    : minutesAndSeconds
}

export function compactLabTime(
  delta: number,
  locale: string,
  remaining = false
) {
  if (!Number.isFinite(delta)) return ""
  const minutes = Math.max(0, Math.floor(delta / 60_000))
  const round = remaining ? Math.ceil : Math.floor
  const [amount, unit] =
    minutes < 60
      ? ([Math.max(remaining ? 1 : 0, minutes), "minute"] as const)
      : minutes < 1440
        ? ([round(minutes / 60), "hour"] as const)
        : ([round(minutes / 1440), "day"] as const)
  return formatLabUnit(amount, unit, locale)
}
