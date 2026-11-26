import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ConversationDetailHeader } from "@/components/conversations/conversation-detail-header"
import { LabRow } from "@/components/conversations/conversation-lab-row"
import { ConversationMenuDialogs } from "@/components/conversations/conversation-action-dialogs"
import * as api from "@/lib/api"
import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import type { DbConversationSummary } from "@/lib/types"
import enMessages from "@/i18n/messages/en.json"

vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))
vi.mock("@/components/conversations/session-details-dialog", () => ({
  SessionDetailsDialog: () => null,
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(status: "pending" | "completed" = "pending", pinned = false) {
  const callbacks = {
    onSelect: vi.fn(),
    onRename: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),

    onTogglePin: vi.fn(),
    onNewConversation: vi.fn(),
    onLinkTodo: vi.fn(),
  }
  const conversation = {
    id: 42,
    folder_id: 7,
    title: "Menu parity",
    agent_type: "codex",
    status,
    pinned_at: pinned ? "2026-10-16T00:00:00Z" : null,
  } as DbConversationSummary
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SidebarConversationCard
        conversation={conversation}
        isSelected={false}
        timeLabel="2m"
        {...callbacks}
      />
    </NextIntlClientProvider>
  )
  return { ...callbacks, conversation }
}

function menuSnapshot() {
  return {
    slot: screen.getByRole("menu").getAttribute("data-slot"),
    classes: screen.getByRole("menu").className,
    items: screen.getAllByRole("menuitem").map((item) => ({
      label: item.textContent,
      disabled: item.hasAttribute("data-disabled"),
      variant: item.getAttribute("data-variant"),
      icons: item.querySelectorAll("svg").length,
    })),
    separators: screen.getAllByRole("separator").length,
  }
}

describe("conversation title menu entry points", () => {
  it.each([
    ["pending", false],
    ["completed", true],
  ] as const)(
    "opens the identical full menu for %s, pinned=%s",
    async (status, pinned) => {
      const callbacks = setup(status, pinned)
      const user = userEvent.setup()
      fireEvent.contextMenu(screen.getByText("Menu parity"))
      const fromRightClick = menuSnapshot()
      expect(fromRightClick.slot).toBe("context-menu-content")
      expect(fromRightClick.items.map((item) => item.icons)).toEqual(
        fromRightClick.items.map((item) =>
          item.label === enMessages.Folder.sidebar.lab.snooze ? 2 : 1
        )
      )
      expect(fromRightClick.items.map((item) => item.label)).toEqual([
        enMessages.Folder.chat.conversationFind.title,
        enMessages.Folder.conversationCard.newConversation,
        enMessages.Folder.conversationCard.rename,
        pinned
          ? enMessages.Folder.conversationCard.unpin
          : enMessages.Folder.conversationCard.pin,
        enMessages.Folder.sessionDetails.menuLabel,
        enMessages.Folder.conversationCard.shareConversation,
        enMessages.Todos.addConversation,
        enMessages.Todos.linkConversation,
        enMessages.Folder.conversationCard.attachToCurrentSession,
        enMessages.Folder.sidebar.lab[
          status === "completed" ? "unsettle" : "finish"
        ],
        enMessages.Folder.sidebar.lab.snooze,
        enMessages.Folder.conversationCard.closePane,
        enMessages.Folder.conversationCard.restorePaneDraft,
        enMessages.Folder.conversationCard.delete,
      ])
      await user.keyboard("{Escape}")
      await user.click(screen.getByRole("button", { name: "More actions" }))
      expect(menuSnapshot()).toEqual(fromRightClick)
      expect(callbacks.onSelect).not.toHaveBeenCalled()
    }
  )

  it.each(["right-click", "more"])(
    "links the same conversation from %s",
    async (entry) => {
      const callbacks = setup()
      const user = userEvent.setup()
      if (entry === "right-click") {
        fireEvent.contextMenu(screen.getByText("Menu parity"))
      } else {
        await user.click(screen.getByRole("button", { name: "More actions" }))
      }
      await user.click(
        screen.getByRole("menuitem", {
          name: enMessages.Todos.linkConversation,
        })
      )
      expect(callbacks.onLinkTodo).toHaveBeenCalledWith(42, "Menu parity")
      expect(callbacks.onSelect).not.toHaveBeenCalled()
    }
  )

  it.each(["{Enter}", " "])("opens from the keyboard with %s", async (key) => {
    setup()
    const user = userEvent.setup()
    screen.getByRole("button", { name: "More actions" }).focus()
    await user.keyboard(key)
    expect(
      screen.getByRole("menuitem", {
        name: enMessages.Folder.conversationCard.rename,
      })
    ).toBeVisible()
  })
})

it("keeps the same actions in the sidebar, lab and title, and shares the clicked row", async () => {
  const user = userEvent.setup()
  const preview = vi
    .spyOn(api, "getConversationSharePreview")
    .mockResolvedValue({ version: 2, active_share: false, rounds: [] })
  vi.spyOn(api, "getWebServiceConfig").mockResolvedValue({
    port: 3080,
    token: null,
    autoStart: false,
    publicShareUrl: null,
  })
  const { conversation } = setup()
  fireEvent.contextMenu(screen.getByText("Menu parity"))
  const labels = () =>
    screen.getAllByRole("menuitem").map((item) => item.textContent)
  const expected = labels()
  await user.keyboard("{Escape}")
  cleanup()
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConversationMenuDialogs />
      <LabRow
        c={conversation}
        project="Project"
        hasProject
        group="main"
        now={Date.now()}
        selected={false}
        open={vi.fn()}
        change={vi.fn()}
        failureSeen={false}
        details={vi.fn()}
        remove={vi.fn()}
      />
    </NextIntlClientProvider>
  )
  fireEvent.contextMenu(screen.getByText("Menu parity"))
  expect(labels()).toEqual(expected)
  await user.click(
    screen.getByRole("menuitem", {
      name: enMessages.Folder.conversationCard.shareConversation,
    })
  )
  expect(await screen.findByRole("dialog")).toHaveTextContent("Menu parity")
  expect(preview).toHaveBeenCalledWith(conversation.id)
  cleanup()
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConversationDetailHeader
        tabId="other-tab"
        folderId={7}
        folderPath="/project"
        title="Another conversation"
        conversationId={77}
        runtimeConversationId={77}
      />
    </NextIntlClientProvider>
  )
  await user.click(
    screen.getByRole("button", {
      name: enMessages.Folder.conversation.moreActions,
    })
  )
  expect(labels()).toEqual(expected)
})
