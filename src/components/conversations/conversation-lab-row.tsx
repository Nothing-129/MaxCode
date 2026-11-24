"use client"

import { formatConversationTitle } from "@/lib/conversation-title"
import { useState } from "react"
import { useLocale, useNow, useTranslations } from "next-intl"
import {
  AlarmClock,
  Check,
  CircleCheck,
  CircleAlert,
  CircleDashed,
  CircleDotDashed,
  ShieldQuestionMark,
  MessageCircleQuestionMark,
  SquarePen,
  Clock,
  Info,
  Link2,
  Trash2,
  Pencil,
  PinOff,
  Pin,
  Undo2,
} from "lucide-react"
import { toast } from "sonner"
import { AgentIcon } from "@/components/agent-icon"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateConversationPinned, updateConversationTitle } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { isImeCompositionKey } from "@/lib/ime-composition"
import {
  compactLabTime,
  formatLabWorkingDuration,
  labHasWoken,
  labSnoozeUntil,
  labSettledAt,
  type LabGroup,
  type LabMark,
} from "@/lib/conversation-lab"
import type { DbConversationSummary } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useConversationRuntimeStore } from "@/stores/conversation-runtime-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { CustomSnooze, SnoozeChoices } from "./conversation-lab-snooze"
import { LabProjectBadge } from "./lab-project-badge"
import type { LabSignal } from "@/lib/conversation-lab-status"
import {
  buildConversationDraftStorageKey,
  loadMessageInputDraftV2,
} from "@/lib/message-input-draft"
import { labTool } from "./conversation-lab-projects"

const rowAction = cn(labTool, "hover:bg-transparent")

const badgeStyles = {
  approval: [ShieldQuestionMark, "text-amber-700 dark:text-amber-400"],
  input: [MessageCircleQuestionMark, "text-indigo-600 dark:text-indigo-300"],
  preparing: [CircleDashed, "text-sky-600 dark:text-sky-400"],
  working: [CircleDashed, "text-sky-600 dark:text-sky-400"],
  goal: [CircleDashed, "text-sky-600 dark:text-sky-400"],
  waiting: [CircleDotDashed, "text-muted-foreground"],
  failed: [CircleAlert, "text-destructive"],
  limited: [CircleAlert, "text-amber-700 dark:text-amber-400"],
  done: [CircleCheck, "text-emerald-600 dark:text-emerald-400"],
  woken: [AlarmClock, "text-orange-700 dark:text-orange-400"],
} as const

function WorkingDuration({ start }: { start: number }) {
  const now = useNow({ updateInterval: 1000 })
  const locale = useLocale()
  return (
    <span className="tabular-nums">
      {formatLabWorkingDuration(now.getTime() - start, locale)}
    </span>
  )
}

export function LabRow({
  c,
  project,
  hasProject,
  projectColor,
  group,
  mark,
  now,
  selected,
  open,
  change,
  signal,
  failureSeen,
  complete,
  linkTodo,
  details,
  remove,
}: {
  c: DbConversationSummary
  project: string
  hasProject: boolean
  projectColor?: string
  group: LabGroup
  mark?: LabMark
  now: number
  selected: boolean
  open: () => void
  change: (mark?: LabMark) => void
  signal?: LabSignal
  failureSeen: boolean
  complete: () => void
  linkTodo?: () => void
  details: () => void
  remove: () => void
}) {
  const l = useTranslations("Folder.sidebar.lab")
  const t = useTranslations("Folder.conversationCard")
  const tTodos = useTranslations("Todos")
  const tDetails = useTranslations("Folder.sessionDetails")
  const locale = useLocale()
  const [custom, setCustom] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const update = useAppWorkspaceStore((s) => s.updateConversationLocal)
  const unread = useConversationUnreadStore((s) => s.unreadIds.has(c.id))
  const started = useConversationRuntimeStore((s) =>
    group === "running"
      ? s.byConversationId.get(c.id)?.liveMessage?.startedAt
      : undefined
  )
  const snoozed = group === "snoozed"
  const finished = group === "finished"
  const compact = snoozed || finished
  const action = snoozed ? "wake" : finished ? "unsettle" : "finish"
  const wake = () => change()
  const toggleSettlement = () =>
    change(finished ? undefined : { settledAt: Date.now() })
  const title = formatConversationTitle(c.title) || t("untitledConversation")
  const updated = Date.parse(c.updated_at)
  const elapsed = compactLabTime(
    snoozed
      ? (labSnoozeUntil(mark) ?? now) - now
      : now - (labSettledAt(mark) ?? updated),
    locale,
    snoozed
  )
  const ActionIcon = snoozed ? AlarmClock : finished ? Undo2 : CircleCheck
  const liveKind =
    signal?.kind === "failed" && signal.runFailure && failureSeen
      ? undefined
      : (signal?.kind ?? (c.status === "in_progress" ? "working" : undefined))
  const showWoke = !compact && !liveKind && labHasWoken(mark, now)
  const canSnooze =
    signal?.kind !== "approval" &&
    signal?.kind !== "preparing" &&
    !signal?.child
  const hasDraft =
    !selected &&
    !!loadMessageInputDraftV2(buildConversationDraftStorageKey(c.id))
  const status = liveKind ?? (showWoke ? "woken" : unread ? "done" : undefined)
  const BadgeIcon = status ? badgeStyles[status][0] : undefined
  const start = signal?.startedAt ?? started
  const projectIcon = (
    <LabProjectBadge
      name={hasProject ? project : null}
      folderColor={projectColor}
    />
  )
  async function pin() {
    try {
      await updateConversationPinned(c.id, !c.pinned_at)
      update(c.id, { pinned_at: c.pinned_at ? null : new Date().toISOString() })
    } catch (e) {
      toast.error(toErrorMessage(e))
    }
  }
  async function rename() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await updateConversationTitle(c.id, name.trim())
      update(c.id, { title: name.trim() })
      setRenaming(false)
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group/row relative rounded-lg hover:bg-interaction-hover",
              selected && "bg-sidebar-accent"
            )}
          >
            <button
              onClick={open}
              aria-current={selected ? "page" : undefined}
              className="block w-full rounded-lg px-2 py-1.5 text-start"
            >
              {compact ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span title={project}>{projectIcon}</span>
                  <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
                    {title}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 group-hover/row:invisible group-has-[[aria-haspopup=menu][data-state=open]]/row:invisible",
                      snoozed && "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {snoozed && <Clock className="size-3" />}
                    {elapsed}
                  </span>
                </span>
              ) : (
                <>
                  <span className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
                    {projectIcon}
                    <span className="min-w-0 flex-1 truncate">{project}</span>
                    {hasDraft && (
                      <SquarePen
                        role="img"
                        aria-label={l("draft")}
                        className="size-3.5 shrink-0"
                      />
                    )}
                    {c.pinned_at && <Pin className="size-3 shrink-0" />}
                    <span className="flex shrink-0 items-center gap-1 group-hover/row:invisible group-has-[[aria-haspopup=menu][data-state=open]]/row:invisible">
                      {status && BadgeIcon ? (
                        <span
                          aria-hidden={showWoke || undefined}
                          className={cn(
                            "inline-flex items-center gap-1 font-medium",
                            badgeStyles[status][1],
                            showWoke && "invisible"
                          )}
                        >
                          <BadgeIcon aria-hidden="true" className="size-3.5" />
                          {l(status)}
                          {(status === "working" || status === "goal") &&
                            start != null &&
                            Number.isFinite(start) && (
                              <WorkingDuration start={start} />
                            )}
                        </span>
                      ) : (
                        elapsed
                      )}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        unread && group !== "completed" && "font-semibold"
                      )}
                    >
                      {title}
                    </span>
                    <AgentIcon
                      agentType={c.agent_type}
                      className="size-3.5 opacity-60"
                    />
                  </span>
                </>
              )}
            </button>
            <div className="pointer-events-none absolute end-1 top-0 flex items-center">
              <div className="pointer-events-none flex items-center opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100">
                {!compact && canSnooze && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        tabIndex={-1}
                        className={rowAction}
                        aria-label={l("snooze")}
                        title={l("snooze")}
                      >
                        <Clock className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <SnoozeChoices
                        snooze={change}
                        custom={() => setCustom(true)}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <button
                  tabIndex={-1}
                  className={cn(
                    rowAction,
                    !compact && "w-auto gap-1 px-1.5 text-xs"
                  )}
                  onClick={snoozed ? wake : toggleSettlement}
                  title={l(action)}
                  aria-label={l(action)}
                >
                  <ActionIcon className="size-3.5" />
                  {!compact && l("settleShort")}
                </button>
              </div>
              {showWoke && (
                <button
                  type="button"
                  aria-label={l("dismissWoke")}
                  title={l("dismissWoke")}
                  onClick={() => change()}
                  className="pointer-events-auto me-1 mt-1.5 inline-flex h-5 items-center gap-1 rounded-sm text-xs font-medium text-orange-700 hover:underline focus-visible:ring-2 dark:text-orange-400"
                >
                  <AlarmClock aria-hidden="true" className="size-3.5" />
                  {l("woken")}
                </button>
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {c.status !== "completed" && (
            <ContextMenuItem onSelect={complete}>
              <CircleCheck />
              {t("markCompleted")}
            </ContextMenuItem>
          )}
          {linkTodo && (
            <ContextMenuItem onSelect={linkTodo}>
              <Link2 />
              {tTodos("linkConversation")}
            </ContextMenuItem>
          )}

          <ContextMenuItem onSelect={() => void pin()}>
            {c.pinned_at ? <PinOff /> : <Pin />}
            {t(c.pinned_at ? "unpin" : "pin")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={toggleSettlement}>
            {finished ? <Undo2 /> : <Check />}
            {l(finished ? "unsettle" : "finish")}
          </ContextMenuItem>
          {snoozed ? (
            <ContextMenuItem onSelect={wake}>
              <Clock />
              {l("wake")}
            </ContextMenuItem>
          ) : (
            canSnooze && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Clock />
                  {l("snooze")}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <SnoozeChoices
                    context
                    snooze={change}
                    custom={() => setCustom(true)}
                  />
                </ContextMenuSubContent>
              </ContextMenuSub>
            )
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              setName(title)
              setRenaming(true)
            }}
          >
            <Pencil />
            {t("rename")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={details}>
            <Info />
            {tDetails("menuLabel")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={remove}>
            <Trash2 />
            {t("delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {custom && (
        <CustomSnooze close={() => setCustom(false)} snooze={change} />
      )}
      {renaming && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!saving) setRenaming(v)
          }}
        >
          <DialogContent>
            <DialogTitle>{t("renameConversation")}</DialogTitle>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void rename()
              }}
            >
              <Input
                autoFocus
                aria-label={t("rename")}
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeCompositionKey(e) && e.key === "Enter")
                    e.preventDefault()
                }}
              />
              <Button disabled={!name.trim() || saving}>{t("save")}</Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
