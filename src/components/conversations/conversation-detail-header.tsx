"use client"

import { ConversationActionsMenu } from "./conversation-actions-menu"
import { useConversationActionDialogs } from "./conversation-action-dialogs"
import { useConversationDrag } from "@/hooks/use-conversation-drag"
import { openConversationFind } from "@/lib/conversation-find-events"
import {
  DesktopChromeIcon,
  desktopChromeButtonClassName,
} from "@/components/layout/desktop-chrome-icon"
import {
  MobileHeaderActionsSlot,
  MobileHeaderSlot,
} from "@/components/layout/mobile-header-slot"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useImeGuard } from "@/hooks/use-ime-guard"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import {
  deleteConversation,
  updateConversationPinned,
  updateConversationTitle,
} from "@/lib/api"
import {
  conversationTitleTopic,
  formatConversationTitle,
} from "@/lib/conversation-title"
import { formatFolderLabelWithAlias } from "@/lib/folder-display"
import { LabProjectBadge } from "./lab-project-badge"
import { ConversationTitleLabel } from "./conversation-title-label"
import { ConversationTitleTransition } from "./conversation-title-transition"
import { OPEN_CONVERSATION_SHARE_EVENT } from "@/lib/conversation-share-events"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { getRuntimeSession } from "@/stores/conversation-runtime-store"
import type { FolderDetail } from "@/lib/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  resolveActiveSessionDetails,
  type ActiveSessionDetails,
} from "./active-session-details"
import { SessionDetailsDialog } from "./session-details-dialog"

interface ConversationDetailHeaderProps {
  tabId: string
  selectionActive?: boolean
  /** Persisted DB id — null for an unsaved draft (rename / pin /
   *  details / delete disabled until the first send persists the row). */
  conversationId: number | null
  /** Virtual runtime key a new conversation streams under before it reconciles
   *  to `conversationId`; used to resolve live session details. */
  runtimeConversationId: number | null
  folderId: number
  folderPath: string | undefined
  project?: Pick<FolderDetail, "name" | "alias" | "color">
  title: string
}

function linkTitleHost(title: string): string | undefined {
  const value = title.trim()
  if (!/^https?:\/\/\S+$/i.test(value)) return undefined
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

/**
 * Conversation detail header (inline on desktop, in the nav row on mobile): the owning folder name + the
 * conversation title with an overflow menu. A single
 * instance renders fixed above the tile scroll area, scoped to the ACTIVE
 * conversation, so it never scrolls horizontally when many conversations are
 * tiled.
 *
 * The ⋯ menu shares the sidebar conversation card's actions (
 * rename / pin / details / delete) so the two entry points stay
 * consistent, wired to the same APIs. Subscriptions are kept narrow — a
 * primitive `pinned_at != null` boolean — so the header never re-renders on
 * streaming tokens; details data is read on demand at click time via
 * `getRuntimeSession` / store `getState`.
 */
export const ConversationDetailHeader = memo(function ConversationDetailHeader({
  tabId,
  selectionActive,
  conversationId,
  runtimeConversationId,
  folderId,
  folderPath,
  project,
  title,
}: ConversationDetailHeaderProps) {
  const t = useTranslations("Folder.conversationCard")
  const ime = useImeGuard()
  const tConv = useTranslations("Folder.conversation")
  const todosView = useOptionalTodosView()
  const workbenchRoute = useOptionalWorkbenchRoute()
  const setRoute = workbenchRoute?.setRoute
  const { closeTab, closePane, restorePaneDraft, openNewConversationTab } =
    useTabActions()
  const hasArchivedDraft = useTabStore((s) => s.archivedPaneDrafts.length > 0)
  const updateConversationLocal = useAppWorkspaceStore(
    (s) => s.updateConversationLocal
  )
  const refreshConversations = useAppWorkspaceStore(
    (s) => s.refreshConversations
  )
  // A brand-new (draft-origin) conversation keeps streaming under its virtual
  // runtime key even after it persists — its DB row exists, but the live
  // session (detail/turns) stays keyed by `runtimeConversationId`. So details
  // must target that key; the runtime store resolves the fetchable DB id from
  // it. Rename/pin/delete act on `conversationId` (the DB row).
  const runtimeId = runtimeConversationId ?? conversationId
  const summary = useAppWorkspaceStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const child = useTabStore((s) =>
    conversationId == null ? undefined : s.childSummaries?.get(conversationId)
  )
  const conversation = summary ?? child
  const canLinkTodo =
    conversation?.parent_id == null &&
    (runtimeId == null ||
      getRuntimeSession(runtimeId)?.detail?.summary.parent_id == null)
  const isPinned = conversation?.pinned_at != null
  const [details, setDetails] = useState<ActiveSessionDetails | null>(null)
  // Snapshot the action target when a dialog OPENS. The header is a SINGLE
  // instance reused across active tabs (see conversation-detail-panel), and the
  // global tab-switch / close-tab shortcuts still fire while a dialog is open —
  // so a rename/delete confirm must act on the conversation the dialog was
  // opened for, not whatever happens to be active at confirm time.
  const [renameTarget, setRenameTarget] = useState<{
    id: number
    title: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number
    tabId: string
    title: string
  } | null>(null)
  const persisted = conversationId != null
  const displayTitle =
    formatConversationTitle(title) || t("untitledConversation")
  const {
    handleShareOpen,
    handleTodoShareOpen,
    linkTodo,
    shareLoading,
    dialogs,
  } = useConversationActionDialogs(conversationId, displayTitle)
  const titleLocked = conversation?.title_locked
  const headerTitle =
    (!titleLocked && linkTitleHost(displayTitle)) || displayTitle
  const projectName =
    folderPath && project ? formatFolderLabelWithAlias(project) : null

  const handleTogglePin = useCallback(() => {
    if (conversationId == null) return
    const next = !isPinned
    // Optimistic: instantly reorder the sidebar row; the upsert echo reconciles
    // the server `pinned_at` (mirrors sidebar card handleTogglePin).
    updateConversationLocal(conversationId, {
      pinned_at: next ? new Date().toISOString() : null,
    })
    updateConversationPinned(conversationId, next).catch((err) => {
      console.error("[ConversationDetailHeader] toggle pin:", err)
    })
  }, [conversationId, isPinned, updateConversationLocal])

  const handleRenameOpen = useCallback(() => {
    if (conversationId == null) return
    setRenameValue(conversationTitleTopic(title))
    setRenameTarget({ id: conversationId, title })
  }, [conversationId, title])

  const handleRenameConfirm = useCallback(async () => {
    if (renameTarget == null) return
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== renameTarget.title) {
      try {
        await updateConversationTitle(renameTarget.id, trimmed)
        refreshConversations()
      } catch (err) {
        console.error("[ConversationDetailHeader] rename:", err)
      }
    }
    setRenameTarget(null)
  }, [renameTarget, renameValue, refreshConversations])

  const handleDeleteOpen = useCallback(() => {
    if (conversationId == null) return
    setDeleteTarget({ id: conversationId, tabId, title: displayTitle })
  }, [conversationId, tabId, displayTitle])

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTarget == null) return
    try {
      await deleteConversation(deleteTarget.id)
      // The deleted conversation is gone — close its tab and refresh the list.
      // Not recorded for reopen: there is no longer a conversation to reopen.
      closeTab(deleteTarget.tabId, { recordForReopen: false })
      refreshConversations()
    } catch (err) {
      console.error("[ConversationDetailHeader] delete:", err)
    }
    setDeleteTarget(null)
  }, [deleteTarget, closeTab, refreshConversations])

  const handleOpenDetails = useCallback(() => {
    // Resolve on demand (no reactive whole-session subscription) via the same
    // helper the panel uses; `runtimeId` covers the virtual-key case.
    if (runtimeId == null) return
    const session = getRuntimeSession(runtimeId)
    const conversations = useAppWorkspaceStore.getState().conversations
    const resolved = resolveActiveSessionDetails(
      {
        conversationId,
        runtimeConversationId: runtimeConversationId ?? undefined,
      },
      (id) => (id === runtimeId ? session : null),
      conversations
    )
    if (!resolved.summary) return
    setDetails(resolved)
  }, [conversationId, runtimeConversationId, runtimeId])

  const titleDragged = useRef(false)
  const handleTitleDrag = useConversationDrag(tabId, title, () => {
    titleDragged.current = true
  })

  const activeTabId = useTabStore((state) => state.activeTabId)
  function find() {
    const id = runtimeConversationId ?? conversationId
    if (id != null) openConversationFind(id)
  }
  useEffect(() => {
    const handleShareRequest = (event: Event) => {
      if ((event as CustomEvent<string>).detail === tabId) handleShareOpen()
    }
    window.addEventListener(OPEN_CONVERSATION_SHARE_EVENT, handleShareRequest)
    return () => {
      window.removeEventListener(
        OPEN_CONVERSATION_SHARE_EVENT,
        handleShareRequest
      )
    }
  }, [handleShareOpen, tabId])

  const conversationMenuItems = (
    <ConversationActionsMenu
      conversation={conversation}
      folderId={folderId}
      tabId={tabId}
      pinned={isPinned}
      rename={persisted ? handleRenameOpen : undefined}
      pin={persisted ? handleTogglePin : undefined}
      details={persisted ? handleOpenDetails : undefined}
      remove={persisted ? handleDeleteOpen : undefined}
      find={runtimeId != null ? find : undefined}
      share={persisted ? handleShareOpen : undefined}
      addTodo={
        persisted && setRoute && !shareLoading ? handleTodoShareOpen : undefined
      }
      linkTodo={
        persisted &&
        canLinkTodo &&
        todosView?.state &&
        (todosView.state.mode === "personal" || todosView.state.active_team_id)
          ? linkTodo
          : undefined
      }
      closePane={() => closePane(tabId)}
      restoreDraft={hasArchivedDraft ? restorePaneDraft : undefined}
    />
  )

  const header = (
    // Transparent (no surface class): the title header reads as part of the
    // message canvas below it rather than as a frosted chrome band. The supplied
    // desktop reference uses a compact title and quiet sharing action, sharing
    // one row with window controls. With a workspace background image on, the whole top
    // of the column reveals the canvas.
    <div className="relative flex h-14 min-w-0 shrink-0 items-center gap-1 md:h-12 md:gap-2 md:pl-[var(--conversation-header-left,0.75rem)] md:pr-[max(5.5rem,var(--conversation-header-right,0.75rem))]">
      <MobileHeaderActionsSlot active={activeTabId === tabId}>
        {conversationMenuItems}
      </MobileHeaderActionsSlot>
      <div
        className={cn(
          "absolute inset-x-2 inset-y-0 flex min-w-0 flex-col items-center justify-center md:flex-row md:gap-1",
          projectName ? "md:static md:flex-1 md:justify-start" : "md:inset-x-28"
        )}
      >
        {projectName && (
          <>
            <button
              type="button"
              className="hidden min-h-7 min-w-0 max-w-[45%] cursor-pointer items-center gap-1.5 rounded-sm text-[15px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:inline-flex"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              aria-label={`${projectName} · ${t("newConversation")}`}
              title={`${projectName} · ${t("newConversation")}`}
              onClick={() => {
                if (folderPath) openNewConversationTab(folderId, folderPath)
              }}
            >
              <LabProjectBadge
                name={projectName}
                folderColor={project?.color}
              />
              <span className="truncate">{projectName}</span>
            </button>
            <span
              aria-hidden="true"
              className="hidden shrink-0 text-muted-foreground md:inline"
            >
              /
            </span>
          </>
        )}
        <span
          data-conversation-title=""
          data-selection-active={selectionActive}
          className="grid min-w-0 max-w-full grid-cols-[minmax(0,auto)] truncate text-[15px] leading-[18px] font-medium text-foreground md:cursor-grab md:active:cursor-grabbing"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onPointerDown={(event) => {
            if (event.button === 1) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
            titleDragged.current = false
            handleTitleDrag(event)
          }}
          onClick={(event) => {
            if (event.button !== 0 || titleDragged.current || !folderPath)
              return
            openNewConversationTab(folderId, folderPath)
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return
            event.preventDefault()
            event.stopPropagation()
            closePane(tabId)
          }}
          title={displayTitle}
        >
          <ConversationTitleTransition
            tabId={tabId}
            title={headerTitle}
            titleLocked={titleLocked}
          >
            <ConversationTitleLabel
              title={headerTitle}
              fallback={t("untitledConversation")}
            />
          </ConversationTitleTransition>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "hidden items-center justify-center md:flex",
                desktopChromeButtonClassName
              )}
              aria-label={tConv("moreActions")}
              title={tConv("moreActions")}
            >
              <DesktopChromeIcon name="more" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {conversationMenuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={renameTarget != null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameConversation")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return
              if (e.key === "Enter") handleRenameConfirm()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleRenameConfirm}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialogs}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConversationDescription", {
                title: deleteTarget?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {details?.summary && (
        <SessionDetailsDialog
          open
          onOpenChange={(o) => {
            if (!o) setDetails(null)
          }}
          summary={details.summary}
          stats={details.stats}
          model={details.model}
        />
      )}
    </div>
  )

  return <MobileHeaderSlot>{header}</MobileHeaderSlot>
})
