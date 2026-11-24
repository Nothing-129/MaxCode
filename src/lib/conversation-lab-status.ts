import type { ConnectionState } from "@/contexts/acp-connections-context"
import {
  normalizeToolName,
  parseGoalUpdateTitle,
} from "./tool-call-normalization"

const priority = [
  "approval",
  "input",
  "limited",
  "failed",
  "preparing",
  "waiting",
  "goal",
  "working",
] as const
export type LabStatusKind = (typeof priority)[number]
export interface LabSignal {
  kind: LabStatusKind
  edge?: string
  startedAt?: number
  raisedAt?: number
  child?: boolean
  runFailure?: boolean
}

export function labConnectionSignal(
  conn?: ConnectionState
): LabSignal | undefined {
  if (!conn || conn.status === "disconnected") return
  const approval =
    conn.pendingPermission?.request_id ?? conn.pendingPlanApproval?.approval_id
  const question =
    conn.pendingAskQuestion?.question_id ?? conn.pendingQuestion?.tool_call_id
  if (approval)
    return {
      kind: "approval",
      edge: JSON.stringify([conn.connectionId, "approval", approval]),
    }
  if (question)
    return {
      kind: "input",
      raisedAt: conn.pendingAskQuestion?.created_at
        ? Date.parse(conn.pendingAskQuestion.created_at)
        : undefined,
      edge: JSON.stringify([conn.connectionId, "input", question]),
    }
  const failure = conn.sessionFailures
    ?.slice()
    .reverse()
    .find((f) => !f.resolved && f.severity === "error")
  if (failure)
    return {
      kind: failure.category === "limit" ? "limited" : "failed",
      edge: JSON.stringify([conn.connectionId, failure.id, failure.revision]),
      runFailure: true,
    }
  if (conn.status === "error")
    return {
      kind: "failed",
      edge: JSON.stringify([conn.connectionId, "error", conn.error]),
    }
  if (conn.status === "connecting") return { kind: "preparing" }
  if (conn.status !== "prompting") return
  const message = conn.liveMessage
  let goal = false
  for (const block of message?.content ?? []) {
    if (block.type === "turn_error")
      return {
        kind: "failed",
        edge: JSON.stringify([conn.connectionId, "turn", message?.id]),
        runFailure: true,
      }
    if (block.type !== "tool_call") continue
    const info = block.info
    if (info.status === "pending" || info.status === "in_progress") {
      if (info.title === "wait_agent") return { kind: "waiting" }
      if (normalizeToolName(info.title) === "get_delegation_status") {
        try {
          const args = JSON.parse(info.raw_input ?? "{}")
          if (typeof args?.wait_ms === "number" && args.wait_ms >= 0)
            return { kind: "waiting" }
        } catch {
          /* Partial streaming arguments. */
        }
      }
    }
    const update = parseGoalUpdateTitle(info.title)
    if (update) goal = update.status === "active"
  }
  return { kind: goal ? "goal" : "working", startedAt: message?.startedAt }
}

export function preferLabSignal(a: LabSignal | undefined, b: LabSignal) {
  return !a || priority.indexOf(b.kind) < priority.indexOf(a.kind) ? b : a
}

export function shouldWakeLabSnooze(
  signal?: LabSignal,
  previousEdge?: string,
  snoozedAt?: number
) {
  if (!signal?.edge) return false
  return (
    signal.kind === "approval" ||
    signal.child === true ||
    (previousEdge !== signal.edge &&
      !(
        signal.raisedAt != null &&
        snoozedAt != null &&
        signal.raisedAt <= snoozedAt
      ))
  )
}
