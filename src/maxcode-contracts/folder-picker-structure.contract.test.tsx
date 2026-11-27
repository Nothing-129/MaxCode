import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ReactFlowProvider } from "@xyflow/react"
import { describe, expect, it, vi } from "vitest"
import { FolderPicker } from "@/components/chat/conversation-context-bar"
import { AddNodeMenu } from "@/components/canvas/add-node-menu"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import type { FolderDetail } from "@/lib/types"

import { NextIntlClientProvider } from "next-intl"
import messages from "@/i18n/messages/en.json"
import { FolderSelect } from "@/components/shared/folder-select"

const folders = [
  { id: 1, name: "repo", alias: "同名项目", path: "/one/repo" },
  { id: 2, name: "repo", alias: "同名项目", path: "/two/repo" },
  { id: 3, name: "maxcode", path: "/work/maxcode" },
]

vi.mock("@/hooks/use-acp-agents", () => ({
  useAcpAgents: () => ({ agents: [] }),
}))
function setup() {
  const onSelect = vi.fn()
  const onSelectChatMode = vi.fn()
  render(
    <FolderPicker
      folders={folders}
      currentFolderId={3}
      currentFolderName="maxcode"
      title="工作文件夹"
      editable
      onSelect={onSelect}
      labelEmpty="没有匹配的文件夹"
      labelSearch="搜索文件夹..."
      labelChatMode="聊天模式"
      labelChatModeDescription="不关联任何工作区"
      isChatMode={false}
      onSelectChatMode={onSelectChatMode}
    />
  )
  return { user: userEvent.setup(), onSelect, onSelectChatMode }
}
describe("folder selector structure", () => {
  it("places chat mode above search and search above the scrollable folder list", async () => {
    const { user } = setup()
    await user.click(screen.getByRole("button"))
    const chat = screen.getByTitle("不关联任何工作区")
    const divider = screen.getByRole("separator")
    const search = screen.getByRole("combobox")
    const folders = screen.getByRole("listbox")
    expect(search.parentElement?.querySelector("svg")).toBeNull()
    expect(
      chat.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      divider.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      search.compareDocumentPosition(folders) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(chat.closest("[data-folder-scroll]")).toBeNull()
    expect(screen.getByText("/one/repo")).toBeVisible()
    expect(screen.getByText("/two/repo")).toBeVisible()
    expect(screen.getByPlaceholderText("搜索文件夹...")).toHaveFocus()
  })
  it("matches the chat glyph to the folder ink color and optical height", async () => {
    const { user } = setup()
    await user.click(screen.getByRole("button"))
    const glyph = screen
      .getByRole("button", { name: "聊天模式" })
      .querySelector("svg")
    expect(glyph).toHaveClass("size-4", "text-foreground", "scale-y-90")
  })
  it("opens a touch folder picker without focusing search until tapped", async () => {
    const media = window.matchMedia
    const mock = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) =>
        query === "(pointer: coarse)"
          ? { ...media(query), matches: true }
          : media(query)
      )
    try {
      const { user, onSelect } = setup()
      await user.click(screen.getByRole("button"))
      const search = screen.getByRole("combobox")
      expect(screen.getByRole("dialog")).toHaveFocus()
      expect(search).not.toHaveFocus()
      await user.click(search)
      expect(search).toHaveFocus()
      await user.type(search, "/two/repo")
      await user.keyboard("{Enter}")
      expect(onSelect).toHaveBeenCalledWith(2)
    } finally {
      mock.mockRestore()
    }
  })
  it("shows an explicit empty state without switching folders and keeps chat mode reachable", async () => {
    const { user, onSelect, onSelectChatMode } = setup()
    await user.click(screen.getByRole("button"))
    await user.type(screen.getByPlaceholderText("搜索文件夹..."), "zzzzz")
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的文件夹")
    expect(onSelect).not.toHaveBeenCalled()
    await user.tab({ shift: true })
    expect(screen.getByRole("button", { name: "聊天模式" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(onSelectChatMode).toHaveBeenCalledOnce()
  })
  it("searches paths and commits only after Enter", async () => {
    const { user, onSelect } = setup()
    await user.click(screen.getByRole("button"))
    await user.type(screen.getByPlaceholderText("搜索文件夹..."), "/two/repo")
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}")
    expect(onSelect).toHaveBeenCalledWith(2)
  })
})

it("pins all folders above the same icon-free search used by the composer", async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FolderSelect
        folders={folders}
        value={3}
        onChange={onChange}
        allLabel="All folders"
        onSelectAll={vi.fn()}
      />
    </NextIntlClientProvider>
  )
  await user.click(screen.getByRole("button"))
  const search = screen.getByRole("combobox")
  const all = screen.getByRole("button", { name: "All folders" })
  expect(search).toHaveFocus()
  expect(search.parentElement?.querySelector("svg")).toBeNull()
  expect(
    all.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(screen.queryByText("/work/maxcode")).toBeNull()
  expect(screen.getByText("/one/repo")).toBeVisible()
  await user.type(screen.getByRole("combobox"), "/two/repo")
  expect(onChange).not.toHaveBeenCalled()
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenCalledWith(2)
  await user.click(screen.getByRole("button"))
  expect(screen.getByRole("combobox")).toHaveValue("")
})

it("opens the searchable folder menu when adding a canvas folder region", async () => {
  const user = userEvent.setup()
  const previous = useAppWorkspaceStore.getState()
  const onCreate = vi.fn()
  useAppWorkspaceStore.setState({ folders: folders as FolderDetail[] })
  try {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReactFlowProvider>
          <AddNodeMenu onCreate={onCreate} onNewConversation={vi.fn()} />
        </ReactFlowProvider>
      </NextIntlClientProvider>
    )
    const trigger = screen.getByRole("button", {
      name: messages.Canvas.addNode,
    })
    await user.click(trigger)
    await user.click(
      screen.getByRole("menuitem", { name: messages.Canvas.addFolderRegion })
    )
    const search = await screen.findByRole("combobox")
    expect(search).toHaveFocus()
    await user.type(search, "/two/repo")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(onCreate).not.toHaveBeenCalled()
    await user.keyboard("{Enter}")
    expect(onCreate).toHaveBeenCalledOnce()
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "folder", folderId: 2 })
    )
    expect(search).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  } finally {
    act(() => useAppWorkspaceStore.setState(previous))
  }
})
