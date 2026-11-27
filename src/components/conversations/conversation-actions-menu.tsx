"use client"

import { updateConversationPinned } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { toast } from "sonner"
import { formatConversationTitle } from "@/lib/conversation-title"
import { useIsMobile } from "@/hooks/use-mobile"
import { useNow, useTranslations } from "next-intl"
import {
  AtSign,
  Check,
  ClipboardPlus,
  Clock,
  Info,
  Link2,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  SquarePen,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import * as Context from "@/components/ui/context-menu"
import * as Dropdown from "@/components/ui/dropdown-menu"
import { DesktopChromeIcon } from "@/components/layout/desktop-chrome-icon"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import { useTabStore } from "@/contexts/tab-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { emitAttachSessionToSession } from "@/lib/session-attachment-events"
import { labGroup, labKey, type LabMark } from "@/lib/conversation-lab"
import type { DbConversationSummary } from "@/lib/types"
import { useOptionalLabState } from "./conversation-lab-context"
import { SnoozeChoices } from "./conversation-lab-snooze"
import { requestConversationMenuAction } from "./conversation-menu-request"

type Action = () => void
interface Props {
  context?: boolean
  conversation?: DbConversationSummary
  folderId: number
  tabId?: string
  pinned: boolean
  rename?: Action
  pin?: Action
  details?: Action
  remove?: Action
  find?: Action
  share?: Action
  addTodo?: Action
  linkTodo?: Action
  newConversation?: Action
  closePane?: Action
}

export function ConversationActionsMenu({
  context = false,
  conversation: c,
  folderId,
  tabId,
  pinned,
  rename,
  pin,
  details,
  remove,
  find,
  share,
  addTodo,
  linkTodo,
  newConversation,
  closePane,
}: Props) {
  const t = useTranslations("Folder.conversationCard")
  const sidebar = useTranslations("Folder.sidebar")
  const l = useTranslations("Folder.sidebar.lab")
  const tTodos = useTranslations("Todos")
  const tDetails = useTranslations("Folder.sessionDetails")
  const tFind = useTranslations("Folder.chat.conversationFind")
  const route = useOptionalWorkbenchRoute()
  const todos = useOptionalTodosView()?.state
  const lab = useOptionalLabState()
  const tab = useTabStore((s) =>
    s.tabs?.find((t) =>
      tabId ? t.id === tabId : c && t.conversationId === c.id
    )
  )
  const active = useTabStore(
    (s) =>
      s.tabs?.find((t) => t.id === s.activeTabId && t.kind === "conversation")
        ?.id
  )
  const archived = useTabStore((s) => (s.archivedPaneDrafts?.length ?? 0) > 0)
  const folder = useAppWorkspaceStore((s) =>
    s.allFolders?.find((f) => f.id === folderId)
  )
  const mark = c && lab?.marks.get(labKey(c))
  const signal = c && lab?.signals.get(c.id)
  const now = useNow({ updateInterval: 5000 }).getTime()
  const mobile = useIsMobile()
  const group = c && labGroup(c, mark, now, signal)
  const change = (value?: LabMark) => {
    if (c) lab?.change(c, value, signal?.edge)
  }
  const Item = context ? Context.ContextMenuItem : Dropdown.DropdownMenuItem
  const Separator = context
    ? Context.ContextMenuSeparator
    : Dropdown.DropdownMenuSeparator
  const Sub = context ? Context.ContextMenuSub : Dropdown.DropdownMenuSub
  const Trigger = context
    ? Context.ContextMenuSubTrigger
    : Dropdown.DropdownMenuSubTrigger
  const Content = context
    ? Context.ContextMenuSubContent
    : Dropdown.DropdownMenuSubContent
  function toggleSettlement() {
    change(group === "finished" ? undefined : { settledAt: Date.now() })
  }
  function request(action: "find" | "share" | "todo" | "link") {
    if (!c) return
    let id = c.id
    if (action === "find") {
      const store = useTabStore.getState()
      if (!store.openTab(folderId, id, c.agent_type)) {
        toast.info(sidebar("folderHeaderMenu.splitLimitReached"))
        return
      }
      route?.openConversations()
      id = tab?.runtimeConversationId ?? id
    }
    requestConversationMenuAction({
      id,
      action,
      title: formatConversationTitle(c.title) || t("untitledConversation"),
    })
  }
  async function togglePin() {
    if (!c) return
    try {
      await updateConversationPinned(c.id, !pinned)
      useAppWorkspaceStore.getState().updateConversationLocal(c.id, {
        pinned_at: pinned ? null : new Date().toISOString(),
      })
    } catch (error) {
      toast.error(toErrorMessage(error))
    }
  }
  function item(
    label: string,
    icon: React.ReactNode,
    action?: Action,
    destructive = false
  ) {
    return (
      <Item
        disabled={!action}
        onSelect={action}
        variant={destructive ? "destructive" : "default"}
      >
        {icon}
        {label}
      </Item>
    )
  }
  const findItem = item(
    tFind("title"),
    <Search />,
    mobile ? undefined : (find ?? (c ? () => request("find") : undefined))
  )
  return (
    <>
      {context && (
        <>
          {findItem}
          {item(
            t("newConversation"),
            <SquarePen />,
            newConversation ??
              (folder
                ? () => {
                    const store = useTabStore.getState()
                    if (folder.kind === "chat") store.openChatModeTab()
                    else store.openNewConversationTab(folder.id, folder.path)
                    route?.openConversations()
                  }
                : undefined)
          )}
          <Separator />
        </>
      )}
      {item(t("rename"), <Pencil />, rename)}
      {item(
        t(pinned ? "unpin" : "pin"),
        pinned ? <PinOff /> : <Pin />,
        pin ?? (c ? togglePin : undefined)
      )}
      {item(tDetails("menuLabel"), <Info />, details)}
      {item(
        t("shareConversation"),
        <DesktopChromeIcon name="share" />,
        share ?? (c && context ? () => request("share") : undefined)
      )}
      {item(
        tTodos("addConversation"),
        <ClipboardPlus />,
        addTodo ?? (c && context && route ? () => request("todo") : undefined)
      )}
      {item(
        tTodos("linkConversation"),
        <Link2 />,
        c?.parent_id != null
          ? undefined
          : (linkTodo ??
              (c &&
              context &&
              todos &&
              (todos.mode === "personal" || todos.active_team_id)
                ? () => request("link")
                : undefined))
      )}
      {!context && findItem}
      {context &&
        item(
          t("attachToCurrentSession"),
          <AtSign />,
          active && c
            ? () => {
                const { tabs, activeTabId } = useTabStore.getState()
                const target = tabs.find(
                  (t) => t.id === activeTabId && t.kind === "conversation"
                )?.id
                if (target)
                  emitAttachSessionToSession({ tabId: target, conversation: c })
              }
            : undefined
        )}
      <Separator />
      <Item disabled={!c || !lab} onSelect={toggleSettlement}>
        {group === "finished" ? <Undo2 /> : <Check />}
        {l(group === "finished" ? "unsettle" : "finish")}
      </Item>
      {group === "snoozed" ? (
        item(l("wake"), <Clock />, () => change())
      ) : (
        <Sub>
          <Trigger
            disabled={
              !c ||
              !lab ||
              signal?.child ||
              signal?.kind === "approval" ||
              signal?.kind === "preparing"
            }
          >
            <Clock />
            {l("snooze")}
          </Trigger>
          <Content>
            <SnoozeChoices
              context={context}
              snooze={change}
              custom={() => lab?.customSnooze(change)}
            />
          </Content>
        </Sub>
      )}
      <Separator />
      {item(
        t("closePane"),
        <X />,
        closePane ??
          (tab ? () => useTabStore.getState().closePane(tab.id) : undefined)
      )}
      {context &&
        item(
          t("restorePaneDraft"),
          <RotateCcw />,
          archived ? () => useTabStore.getState().restorePaneDraft() : undefined
        )}
      <Separator />
      {item(t("delete"), <Trash2 />, remove, true)}
    </>
  )
}
