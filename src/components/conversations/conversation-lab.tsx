"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useNow, useTranslations } from "next-intl"
import { ChevronDown, Search, X } from "lucide-react"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useSidebarScrollMotion } from "@/hooks/use-sidebar-scroll-motion"
import { AgentIcon } from "@/components/agent-icon"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import {
  excludeChatFolders,
  filterTopLevelFolders,
  formatFolderLabelWithAlias,
} from "@/lib/folder-display"
import {
  isConversationSettled,
  labGroup,
  labSnoozeUntil,
  labSettledAt,
  labGroups,
  labHasWoken,
  labKey,
  type LabGroup,
} from "@/lib/conversation-lab"
import { SessionDetailsDialog } from "./session-details-dialog"
import { ConversationDeleteDialog } from "./conversation-delete-dialog"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import {
  TodoConversationLinkDialog,
  type TodoConversationLinkTarget,
} from "@/components/todos/todo-conversation-link-dialog"
import { formatConversationTitle } from "@/lib/conversation-title"
import { deleteConversation } from "@/lib/api"
import { useSidebarNavigation } from "@/contexts/sidebar-navigation-context"
import { updatedWithinDateRange } from "@/lib/sidebar-navigation"
import { getTransport } from "@/lib/transport"
import { isImeCompositionKey } from "@/lib/ime-composition"
import { toErrorMessage } from "@/lib/app-error"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LabProjectTools } from "./conversation-lab-projects"
import { LabProjectBadge } from "./lab-project-badge"
import { useLabState } from "./conversation-lab-state"

import { LabRow } from "./conversation-lab-row"

interface Row {
  c: DbConversationSummary
  project: string
  projectId: string
  projectColor?: string
}
const shelves = ["running", "completed", "snoozed", "finished"] as const

function LabScrollArea({
  children,
  className,
}: {
  children: React.ReactNode
  className: string
}) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  useSidebarScrollMotion(viewport)

  return (
    <ScrollArea
      className={cn("px-2 [overflow-anchor:none]", className)}
      onViewportRef={setViewport}
    >
      {children}
    </ScrollArea>
  )
}

function useContentMatches(query: string, candidates: Row[]) {
  const [result, setResult] = useState<{
    query: string
    matches: Map<number, string>
    busy: boolean
    error?: string
  }>()
  useEffect(() => {
    if (!query || !candidates.length) return
    let active = true
    const timer = setTimeout(async () => {
      const matches = new Map<number, string>()
      try {
        for (let i = 0; active && i < candidates.length; i += 8) {
          const conversationIds = candidates.slice(i, i + 8).map((r) => r.c.id)
          const response = await getTransport().call<[number, string][]>(
            "search_conversation_text",
            { conversationIds, query }
          )
          if (!active) return
          for (const [id, text] of response) matches.set(id, text)
          setResult({
            query,
            matches: new Map(matches),
            busy: i + 8 < candidates.length,
          })
        }
      } catch (e) {
        if (active)
          setResult({ query, matches, busy: false, error: toErrorMessage(e) })
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, candidates])
  return query && candidates.length && result?.query === query
    ? result
    : undefined
}

function LabShelf({
  group,
  count,
  children,
}: {
  group: (typeof shelves)[number]
  count: number
  children: (expanded: boolean) => React.ReactNode
}) {
  const l = useTranslations("Folder.sidebar.lab")
  const key = "maxcode:lab-shelf:" + group
  const completedLabel = useTranslations("Folder.statusLabels")("completed")
  const isActivityShelf = group === "running" || group === "completed"
  const [open, setOpen] = useState(() => {
    if (isActivityShelf) return true
    try {
      return localStorage.getItem(key) === "1"
    } catch {
      return false
    }
  })
  return (
    <>
      <details
        open={open}
        className={cn("group/section shrink-0", isActivityShelf && "mb-2")}
      >
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs",
            isActivityShelf
              ? "rounded-md bg-sidebar-accent/60 font-semibold text-sidebar-foreground hover:bg-sidebar-accent"
              : "font-semibold text-muted-foreground hover:text-sidebar-foreground"
          )}
          onClick={(e) => {
            e.preventDefault()
            setOpen(!open)
            if (isActivityShelf) return
            try {
              localStorage.setItem(key, open ? "0" : "1")
            } catch {}
          }}
        >
          <ChevronDown className="size-3 -rotate-90 group-open/section:rotate-0" />
          {group === "completed" ? completedLabel : l(group)}
          <span className="ms-auto tabular-nums">{count}</span>
        </summary>
        {open && children(true)}
      </details>
      {!open && !isActivityShelf && children(false)}
    </>
  )
}

export function ConversationLab({
  mobile,
  onNavigate,
}: {
  mobile: boolean
  onNavigate?: () => void
}) {
  const t = useTranslations("Folder.sidebar")
  const l = useTranslations("Folder.sidebar.lab")
  const untitled = useTranslations("Folder.conversationCard")(
    "untitledConversation"
  )
  const folders = useAppWorkspaceStore((s) => s.allFolders)
  const openFolders = useAppWorkspaceStore((s) => s.folders)
  const conversations = useAppWorkspaceStore((s) => s.conversations)
  const unreadIds = useConversationUnreadStore((s) => s.unreadIds)
  const loading = useAppWorkspaceStore((s) => s.conversationsLoading)
  const error = useAppWorkspaceStore((s) => s.conversationsError)
  const refresh = useAppWorkspaceStore((s) => s.refreshConversations)
  const {
    openTab,
    openChatModeTab,
    openNewConversationTab,
    closeConversationTab,
  } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const selected = useTabStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.conversationId
  )
  const todoState = useOptionalTodosView()?.state
  const tTodos = useTranslations("Todos")
  const [linkTarget, setLinkTarget] =
    useState<TodoConversationLinkTarget | null>(null)
  const [dialog, setDialog] = useState<{
    kind: "details" | "delete"
    c: DbConversationSummary
  } | null>(null)
  async function remove(c: DbConversationSummary) {
    try {
      await deleteConversation(c.id)
      closeConversationTab(c.folder_id, c.id, c.agent_type)
      await refresh()
    } catch (e) {
      toast.error(toErrorMessage(e))
    }
  }
  const [projects, setProjects] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const now = useNow({ updateInterval: 5000 }).getTime()
  const { marks, signals, seenFailures, change } = useLabState()
  const available = useMemo(
    () => folders.filter((f) => f.kind !== "chat" && f.parent_id == null),
    [folders]
  )
  const composeProjects = useMemo(
    () => excludeChatFolders(filterTopLevelFolders(openFolders)),
    [openFolders]
  )
  const { date, endDate, startTime, endTime } = useSidebarNavigation() ?? {}
  const chatLabel = t("sectionChats")
  const rows = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]))
    return conversations
      .flatMap((c): Row[] => {
        if (
          (date &&
            endDate &&
            startTime &&
            endTime &&
            !updatedWithinDateRange(
              c.updated_at,
              date,
              endDate,
              startTime,
              endTime
            )) ||
          c.hide_from_conversation_list ||
          c.parent_id != null ||
          (c.kind !== "regular" && c.kind !== "chat")
        )
          return []
        const folder = byId.get(c.folder_id)
        const root = byId.get(folder?.parent_id ?? c.folder_id) ?? folder
        const project =
          root && root.kind !== "chat" && c.kind !== "chat" ? root : null
        const projectId = project ? String(project.id) : "none"
        return projects.length && !projects.includes(projectId)
          ? []
          : [
              {
                c,
                project: project
                  ? formatFolderLabelWithAlias(project)
                  : chatLabel,
                projectId,
                projectColor: project?.color,
              },
            ]
      })
      .sort(
        (a, b) =>
          Date.parse(b.c.updated_at) - Date.parse(a.c.updated_at) ||
          b.c.id - a.c.id
      )
  }, [
    conversations,
    folders,
    projects,
    chatLabel,
    date,
    endDate,
    startTime,
    endTime,
  ])
  const groups = useMemo(() => {
    const g: Record<LabGroup, Row[]> = {
      pinned: [],
      main: [],
      running: [],
      completed: [],
      snoozed: [],
      finished: [],
    }
    for (const row of rows)
      g[
        labGroup(
          row.c,
          marks.get(labKey(row.c)),
          now,
          signals.get(row.c.id),
          unreadIds.has(row.c.id)
        )
      ].push(row)
    const markedAt = (r: Row) => {
      const mark = marks.get(labKey(r.c))
      return (
        (r.c.lab_settled_at || labSettledAt(mark)) ??
        labSnoozeUntil(mark) ??
        Date.parse(r.c.updated_at)
      )
    }
    g.pinned.sort(
      (a, b) => Date.parse(b.c.pinned_at!) - Date.parse(a.c.pinned_at!)
    )
    g.finished.sort((a, b) => markedAt(b) - markedAt(a))
    g.snoozed.sort((a, b) => markedAt(a) - markedAt(b))
    return g
  }, [rows, marks, now, signals, unreadIds])
  const visibleShelves = shelves.filter(
    (group) => groups[group].length > 0 || (group === "finished" && mobile)
  )
  const term = query.trim().toLocaleLowerCase()
  const titles = useMemo(
    () =>
      term
        ? rows.filter((r) =>
            (formatConversationTitle(r.c.title) || untitled)
              .toLocaleLowerCase()
              .includes(term)
          )
        : [],
    [rows, term, untitled]
  )
  const candidates = useMemo(() => {
    if (!term) return []
    const ids = new Set(titles.map((r) => r.c.id))
    return rows.filter((r) => r.c.external_id && !ids.has(r.c.id))
  }, [rows, titles, term])
  const content = useContentMatches(term, candidates)
  const results = [
    ...titles,
    ...candidates.filter((r) => content?.matches.has(r.c.id)),
  ]
  const activeIndex = Math.min(cursor, results.length - 1)
  const [settledLimit, setSettledLimit] = useState(10)
  function afterOpen(opened: unknown) {
    if (!opened) {
      toast.info(t("folderHeaderMenu.splitLimitReached"))
      return false
    }
    openConversations()
    onNavigate?.()
    return true
  }
  function start(f?: FolderDetail) {
    afterOpen(f ? openNewConversationTab(f.id, f.path) : openChatModeTab())
  }
  function open(c: DbConversationSummary) {
    const opened = afterOpen(openTab(c.folder_id, c.id, c.agent_type, false))
    if (
      opened &&
      !isConversationSettled(c) &&
      labHasWoken(marks.get(labKey(c)), now)
    )
      change(c)
    return opened
  }
  function search(value: string) {
    setQuery(value)
    setCursor(0)
  }
  function choose(r: Row) {
    if (open(r.c)) search("")
  }
  function renderRows(group: LabGroup, expanded = true) {
    const items = groups[group]
    const limit = group === "finished" ? settledLimit : items.length
    const visible = items.filter(
      (r, i) => (expanded && i < limit) || r.c.id === selected
    )
    return (
      <>
        {visible.map(({ c, project, projectId, projectColor }) => (
          <LabRow
            key={labKey(c)}
            c={c}
            project={project}
            hasProject={projectId !== "none"}
            projectColor={projectColor}
            group={group}
            mark={marks.get(labKey(c))}
            now={now}
            selected={selected === c.id}
            open={() => open(c)}
            signal={signals.get(c.id)}
            failureSeen={
              seenFailures.get(labKey(c)) === signals.get(c.id)?.edge
            }
            change={(mark) =>
              change(
                c,
                mark,
                typeof mark === "number" && mark > now
                  ? signals.get(c.id)?.edge
                  : undefined
              )
            }
            details={() => setDialog({ kind: "details", c })}
            remove={() => setDialog({ kind: "delete", c })}
            linkTodo={
              todoState &&
              (todoState.mode === "personal" || todoState.active_team_id)
                ? () =>
                    setLinkTarget({
                      conversationId: c.id,
                      title: formatConversationTitle(c.title) || untitled,
                      scopeId:
                        todoState.mode === "personal"
                          ? "personal"
                          : todoState.active_team_id!,
                      scopeName:
                        todoState.mode === "personal"
                          ? tTodos("personalMode")
                          : (todoState.teams.find(
                              (team) => team.id === todoState.active_team_id
                            )?.name ?? tTodos("teamMode")),
                    })
                : undefined
            }
          />
        ))}
        {expanded && items.length > visible.length && (
          <button
            className="px-3 py-1 text-xs text-muted-foreground"
            onClick={() => setSettledLimit(limit + 25)}
          >
            {t("showMoreConversations", {
              count: items.length - visible.length,
            })}
          </button>
        )}
      </>
    )
  }
  const activeRowId = results[activeIndex]
    ? "lab-result-" + results[activeIndex].c.id
    : undefined
  useEffect(() => {
    if (activeRowId)
      document
        .getElementById(activeRowId)
        ?.scrollIntoView?.({ block: "nearest" })
  }, [activeRowId])
  return (
    <section
      aria-label={t("navigation.lab")}
      className="flex min-h-0 flex-1 flex-col pb-2"
    >
      <div className="flex items-center gap-1 px-2 pb-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-transparent px-2 hover:bg-interaction-hover focus-within:ring-1 focus-within:ring-ring">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            type="search"
            value={query}
            aria-label={t("searchPlaceholder")}
            placeholder={l("search")}
            aria-controls={term ? "lab-search-list" : undefined}
            aria-activedescendant={term ? activeRowId : undefined}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => {
              if (isImeCompositionKey(e)) return
              if (e.key === "Escape") {
                e.preventDefault()
                search("")
                return
              }
              if (!term || activeIndex < 0) return
              if (e.key === "Enter") {
                e.preventDefault()
                choose(results[activeIndex])
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                setCursor(
                  (activeIndex +
                    (e.key === "ArrowDown" ? 1 : -1) +
                    results.length) %
                    results.length
                )
              }
            }}
            className="h-7 w-full min-w-0 bg-transparent text-xs outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              className="shrink-0"
              aria-label={l("clear")}
              onClick={() => {
                search("")
                input.current?.focus()
              }}
            >
              <X className="size-3" />
            </button>
          )}
        </label>
        <LabProjectTools
          projects={available}
          composeProjects={composeProjects}
          selected={projects}
          setSelected={setProjects}
          start={start}
        />
      </div>
      {error && (
        <button
          onClick={() => void refresh()}
          className="mx-2 p-2 text-start text-xs text-destructive"
        >
          {error} · {l("retry")}
        </button>
      )}
      {term ? (
        <LabScrollArea className="min-h-0 flex-1">
          <div role="listbox" id="lab-search-list" aria-label={l("search")}>
            {results.map((r, i) => (
              <button
                id={"lab-result-" + r.c.id}
                key={r.c.id}
                role="option"
                aria-selected={i === activeIndex}
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(r)}
                className={cn(
                  "block w-full rounded-lg p-2 text-start",
                  i === activeIndex && "bg-sidebar-accent"
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LabProjectBadge
                    name={r.projectId === "none" ? null : r.project}
                    folderColor={r.projectColor}
                  />
                  <span className="truncate">{r.project}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">
                    {formatConversationTitle(r.c.title) || untitled}
                  </span>
                  <AgentIcon agentType={r.c.agent_type} className="size-3.5" />
                </span>
                {content?.matches.get(r.c.id) && (
                  <small className="line-clamp-2 text-muted-foreground">
                    {content.matches.get(r.c.id)}
                  </small>
                )}
              </button>
            ))}
          </div>
          {content?.error && (
            <p role="alert" className="p-2 text-xs text-destructive">
              {content.error}
            </p>
          )}
          {!results.length && !content?.error && (
            <p role="status" className="p-2 text-xs text-muted-foreground">
              {candidates.length && (!content || content.busy)
                ? l("loading")
                : t("noMatchingConversations")}
            </p>
          )}
        </LabScrollArea>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <LabScrollArea className="h-full">
              {renderRows("pinned")}
              {groups.pinned.length > 0 && (
                <hr
                  aria-hidden="true"
                  data-lab-pinned-divider=""
                  className="mx-2 my-1.5 border-sidebar-border/60"
                />
              )}
              {renderRows("main")}
              {!error && !labGroups.some((g) => groups[g].length) && (
                <p role="status" className="p-2 text-xs text-muted-foreground">
                  {loading ? l("loading") : t("noMatchingConversations")}
                </p>
              )}
            </LabScrollArea>
          </div>
          {visibleShelves.length > 0 && (
            <LabScrollArea className="min-h-0 max-h-[55%] shrink-0 border-t border-sidebar-border/60">
              {visibleShelves.map((group) => (
                <LabShelf
                  key={group}
                  group={group}
                  count={groups[group].length}
                >
                  {(expanded) => renderRows(group, expanded)}
                </LabShelf>
              ))}
            </LabScrollArea>
          )}
        </>
      )}
      {linkTarget && (
        <TodoConversationLinkDialog
          target={linkTarget}
          onClose={() => setLinkTarget(null)}
        />
      )}
      {dialog?.kind === "details" && (
        <SessionDetailsDialog
          open
          summary={dialog.c}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConversationDeleteDialog
          open
          title={dialog.c.title}
          onConfirm={() => void remove(dialog.c)}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      )}
    </section>
  )
}
