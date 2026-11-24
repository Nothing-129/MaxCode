import { LabProjectBadge } from "@/components/conversations/lab-project-badge"
import type { ConnectionState } from "@/contexts/acp-connections-context"
import { useTabStore as tabStore } from "@/stores/tab-store"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import * as api from "@/lib/api"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { ConversationLabProvider } from "@/components/conversations/conversation-lab-state"
import { ConversationLab as LabView } from "@/components/conversations/conversation-lab"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import en from "@/i18n/messages/en.json"
import {
  labGroup,
  labKey,
  loadLabMarks,
  snoozePresets,
} from "@/lib/conversation-lab"
import {
  labConnectionSignal,
  preferLabSignal,
} from "@/lib/conversation-lab-status"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import { describe, expect, it, vi } from "vitest"
import { DATE_FILTER_STORAGE_KEY } from "@/lib/sidebar-navigation"
import {
  NAVIGATION_IDS,
  SidebarNavigationProvider,
} from "@/contexts/sidebar-navigation-context"
import { source } from "./contract-source"

function ConversationLab({ mobile = false }: { mobile?: boolean }) {
  return (
    <ConversationLabProvider>
      <LabView mobile={mobile} />
    </ConversationLabProvider>
  )
}

describe("experimental conversation inbox", () => {
  it("adds an independent destination after the existing navigation", () => {
    expect(
      source("src/components/conversations/conversation-lab.tsx")
    ).not.toContain("PanelLeftClose")
    expect(NAVIGATION_IDS).toEqual([
      "home",
      "conversations",
      "projects",
      "tasks",
      "automations",
      "lab",
    ])
    expect(source("src/components/layout/sidebar.tsx")).toContain(
      "<ConversationLab"
    )
  })
})

it("wakes snoozed conversations into their live status and isolates reused ids", () => {
  const c = {
    id: 2,
    created_at: "2026-11-01",
    status: "in_progress",
  } as DbConversationSummary
  expect(labGroup(c, 1000, 999)).toBe("snoozed")
  expect(labGroup(c, 1000, 1000)).toBe("running")
  expect(labGroup({ ...c, status: "pending_review" }, undefined, 1010)).toBe(
    "main"
  )
  localStorage.setItem(labKey(c), "finished")
  const marks = loadLabMarks()
  expect(labGroup(c, marks.get(labKey(c)), 1010)).toBe("finished")
  expect(marks.get(labKey({ ...c, created_at: "2026-11-02" }))).toBeUndefined()
  localStorage.removeItem(labKey(c))
})

it("keeps connection setup in place until a turn starts", () => {
  const c = { status: "completed" } as DbConversationSummary
  const preparing = labConnectionSignal({
    status: "connecting",
  } as ConnectionState)!
  const working = labConnectionSignal({
    status: "prompting",
  } as ConnectionState)!
  const group = (signal?: typeof preparing) => labGroup(c, undefined, 0, signal)
  expect([group(), group(preparing), group(), group(working)]).toEqual([
    "main",
    "main",
    "main",
    "running",
  ])
  expect(
    labGroup({ ...c, status: "in_progress" }, undefined, 0, preparing)
  ).toBe("main")
  for (const signal of [
    preferLabSignal(working, preparing),
    preferLabSignal(preparing, working),
  ]) {
    expect(group(signal)).toBe("running")
  }
})

const live = vi.hoisted(() => {
  const connections = new Map<string, ConnectionState>()
  const listeners = new Map<string, () => void>()
  const store = {
    getConnection: (key: string) => connections.get(key),
    getConnectPending: () => undefined,
    getConnectError: () => undefined,
    subscribeKey: (key: string, cb: () => void) => {
      listeners.set(key, cb)
      return () => listeners.delete(key)
    },
  }
  return { connections, listeners, store, selected: null as number | null }
})
vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => live.store,
}))
vi.mock("@/contexts/delegation-context", () => ({
  useDelegation: () => ({
    findByChildConversationId: (id: number) => ({
      childConnectionId: "child-" + id,
    }),
  }),
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    openTab: () => true,
    openNewConversationTab: (folderId: number, path: string) =>
      tabStore
        .getState()
        .openNewConversationTab(folderId, path, { rememberContext: false }),
  }),
  useTabStore: () => live.selected,
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations: () => {} }),
}))

it("renders review and ordinary chats directly above running chats", () => {
  const previous = useAppWorkspaceStore.getState()
  const conversations = [
    "completed",
    "pending_review",
    "in_progress",
    "in_progress",
  ].map((status, id) => ({
    id: id || 4,
    status,
    title: ["1124｜Thread 0", "1124｜自动｜Thread 1", "Thread 2", "Thread 3"][
      id
    ],
    kind: "regular",
    agent_type: "codex",
    created_at: "2026-11-01",
    updated_at: "2026-11-0" + (id + 1),
  })) as DbConversationSummary[]
  localStorage.setItem("maxcode:lab-shelf:running", "0")
  live.selected = 2
  useAppWorkspaceStore.setState({ conversations, conversationsLoading: false })
  try {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab />
      </NextIntlClientProvider>
    )
    expect(
      Array.from(container.querySelectorAll("summary"), (s) => s.textContent)
    ).toEqual([en.Folder.sidebar.lab.running + "2"])
    expect(screen.getByText("Thread 1").closest("details")).toBeNull()
    const unread = useConversationUnreadStore.getState()
    try {
      act(() =>
        useConversationUnreadStore.setState({ unreadIds: new Set([4, 1, 2]) })
      )
      const completed = screen.getByText(en.Folder.statusLabels.completed, {
        selector: "summary",
      })
      expect(completed).toHaveTextContent(
        en.Folder.statusLabels.completed + "2"
      )
      expect(Array.from(container.querySelectorAll("summary"))).toEqual([
        screen.getByText(en.Folder.sidebar.lab.running, {
          selector: "summary",
        }),
        completed,
      ])
      expect(completed.parentElement).toHaveAttribute("open")
      expect(screen.getByText("Thread 1").closest("details")).toBe(
        completed.parentElement
      )
      fireEvent.click(completed)
      expect(screen.queryByText("Thread 1")).toBeNull()
      fireEvent.click(completed)
      expect(screen.getByText("Thread 1")).not.toHaveClass("font-semibold")
      expect(screen.getByText("Thread 0")).not.toHaveClass("font-semibold")
      act(() => useConversationUnreadStore.getState().setViewed([4, 1]))
      expect(
        screen.queryByText(en.Folder.statusLabels.completed, {
          selector: "summary",
        })
      ).toBeNull()
      expect(screen.getByText("Thread 1").closest("details")).toBeNull()
      expect(screen.queryByText(en.Folder.sidebar.lab.done)).toBeNull()
      expect(
        screen.getByText("Thread 1").classList.contains("font-semibold")
      ).toBe(false)
    } finally {
      act(() => useConversationUnreadStore.setState(unread))
    }
    expect(container.querySelector("details")).toHaveAttribute("open")
    expect(screen.getByText("Thread 2")).toBeVisible()
    expect(screen.getByText("Thread 3")).toBeVisible()
    fireEvent.click(
      screen.getByText(en.Folder.sidebar.lab.running, { selector: "summary" })
    )
    expect(screen.queryByText("Thread 3")).toBeNull()
    expect(screen.queryByText("Thread 2")).toBeNull()
    fireEvent.click(
      screen.getByText(en.Folder.sidebar.lab.running, { selector: "summary" })
    )
    expect(screen.getAllByText(/^Thread /).map((e) => e.textContent)).toEqual([
      "Thread 1",
      "Thread 0",
      "Thread 3",
      "Thread 2",
    ])
    const searchField = screen.getByRole("searchbox").closest("label")
    expect(searchField).toHaveClass(
      "bg-transparent",
      "hover:bg-interaction-hover"
    )
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Thread" },
    })
    expect(screen.getAllByRole("option")).toHaveLength(4)
    expect(container).not.toHaveTextContent(/1124｜|自动｜/)
    expect(container.querySelector("summary")).toBeNull()
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" })
    expect(container.querySelector("summary")).not.toBeNull()
  } finally {
    live.selected = null
    localStorage.removeItem("maxcode:lab-shelf:running")
    useAppWorkspaceStore.setState(previous)
  }
})

it("opens running and shows the empty settled shelf on mobile", () => {
  const previous = useAppWorkspaceStore.getState()
  const c = {
    id: 42,
    title: "Running on mobile",
    status: "in_progress",
    kind: "regular",
    agent_type: "codex",
    created_at: "2026-11-01",
    updated_at: "2026-11-01",
  } as DbConversationSummary
  localStorage.setItem("maxcode:lab-shelf:running", "0")
  useAppWorkspaceStore.setState({
    conversations: [c],
    conversationsLoading: false,
  })
  try {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab mobile />
      </NextIntlClientProvider>
    )
    const running = screen.getByText(en.Folder.sidebar.lab.running, {
      selector: "summary",
    })
    expect(running.closest("details")).toHaveAttribute("open")
    expect(screen.getByText(c.title!)).toBeVisible()
    const finished = screen.getByText(en.Folder.sidebar.lab.finished, {
      selector: "summary",
    })
    expect(finished).toHaveTextContent(en.Folder.sidebar.lab.finished + "0")
    expect(finished.closest("details")).not.toHaveAttribute("open")
  } finally {
    localStorage.removeItem("maxcode:lab-shelf:running")
    useAppWorkspaceStore.setState(previous)
  }
})

it("offers only future snooze presets, in time order, once per minute", () => {
  const now = new Date(2026, 10, 22, 16, 0)
  const choices = snoozePresets(now.getTime())
  expect(choices.map((p) => p.key)).toEqual([
    "oneHour",
    "tonight",
    "threeHours",
    "tomorrow",
  ])
  expect(new Date(choices[3].at).getHours()).toBe(9)
  expect(
    snoozePresets(new Date(2026, 10, 23, 19).getTime()).map((p) => p.key)
  ).toEqual(["oneHour", "threeHours", "tomorrow", "nextWeek"])
})

it("offers the compose picker without an add-project toolbar button", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConversationLab />
    </NextIntlClientProvider>
  )
  fireEvent.click(
    screen.getByRole("button", { name: en.Folder.sidebar.lab.compose })
  )
  const chat = await screen.findByRole("button", { name: /^Chat mode/ })
  const search = screen.getByRole("combobox")
  expect(
    chat.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(search.parentElement?.querySelector("svg")).toBeNull()
  expect(search).toHaveFocus()
  fireEvent.keyDown(search, { key: "Escape" })
  expect(screen.queryByRole("button", { name: "Add project" })).toBeNull()
})

it("only offers open root projects for new conversations and their number shortcuts", async () => {
  const previous = useAppWorkspaceStore.getState()
  const previousTabs = tabStore.getState()
  const openProject = {
    id: 95,
    name: "Open project",
    path: "/open-project",
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-11-10",
    sort_order: 2,
    color: "inherit",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
  } satisfies FolderDetail
  const closedProject = {
    ...openProject,
    id: 94,
    name: "Closed project",
    path: "/closed-project",
    sort_order: 1,
  }
  const worktree = {
    ...openProject,
    id: 96,
    name: "Open worktree",
    path: "/open-worktree",
    parent_id: openProject.id,
    sort_order: 3,
  }
  useAppWorkspaceStore.setState({
    folders: [openProject, worktree],
    allFolders: [closedProject, openProject, worktree],
  })
  try {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab />
      </NextIntlClientProvider>
    )
    fireEvent.click(
      screen.getByRole("button", { name: en.Folder.sidebar.lab.compose })
    )
    const input = await screen.findByRole("combobox")
    expect(screen.getAllByRole("option")).toEqual([
      screen.getByRole("option", { name: /^Open project/ }),
    ])
    fireEvent.change(input, { target: { value: "/closed-project" } })
    expect(screen.queryByRole("option")).toBeNull()

    fireEvent.change(input, { target: { value: "" } })
    fireEvent.keyDown(input, { key: "1", metaKey: true })
    const { activeTabId, rawTabs } = tabStore.getState()
    expect(rawTabs.find((tab) => tab.id === activeTabId)).toMatchObject({
      folderId: openProject.id,
      workingDir: "/open-project",
      conversationId: null,
    })
  } finally {
    act(() => {
      useAppWorkspaceStore.setState(previous)
      tabStore.setState(previousTabs)
    })
  }
})

it("shows a compact snoozed row, wakes it and lets the user undo settlement", () => {
  const previous = useAppWorkspaceStore.getState()
  const c = {
    id: 431,
    title: "Demo",
    folder_id: 1,
    kind: "regular",
    status: "completed",
    agent_type: "codex",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  } as DbConversationSummary
  localStorage.setItem(labKey(c), String(Date.now() + 3600000))
  useAppWorkspaceStore.setState({
    conversations: [c],
    conversationsLoading: false,
  })
  try {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab />
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByText("Snoozed"))
    const shelf = container.querySelector("details")!
    expect(shelf.textContent).not.toContain("Chat")
    fireEvent.click(screen.getByRole("button", { name: "Wake thread now" }))
    expect(container.querySelector("summary")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Dismiss wake notification" })
    ).toBeNull()
    expect(localStorage.getItem(labKey(c))).toBeNull()
    const settle = screen.getByRole("button", { name: "Settle thread" })
    const snooze = screen.getByRole("button", { name: "Snooze thread" })
    expect(settle.parentElement?.classList.contains("bg-sidebar")).toBe(false)
    expect(settle.parentElement).not.toHaveClass(
      "group-has-[:focus-visible]/row:opacity-100"
    )
    expect(settle.parentElement).not.toHaveClass(
      "group-focus-within/row:opacity-100"
    )
    for (const action of [snooze, settle]) {
      expect(action).toHaveAttribute("tabindex", "-1")
      expect(action.classList.contains("hover:bg-transparent")).toBe(true)
    }
    fireEvent.click(settle)
    expect(localStorage.getItem(labKey(c))).toMatch(/^finished:\d+$/)
    const finished = screen.getByText(en.Folder.sidebar.lab.finished, {
      selector: "summary",
    })
    expect(finished.closest("details")).not.toHaveAttribute("open")
    fireEvent.click(finished)
    expect(localStorage.getItem("maxcode:lab-shelf:finished")).toBe("1")
    fireEvent.click(screen.getByRole("button", { name: "Un-settle thread" }))
    expect(localStorage.getItem(labKey(c))).toBeNull()
  } finally {
    localStorage.removeItem(labKey(c))
    localStorage.removeItem("maxcode:lab-shelf:snoozed")
    localStorage.removeItem("maxcode:lab-shelf:finished")
    useAppWorkspaceStore.setState(previous)
  }
})

it("shows a wake badge when the snooze timer expires and after reopening the lab", () => {
  vi.useFakeTimers()
  const previous = useAppWorkspaceStore.getState()
  const c = {
    id: 432,
    title: "Wake later",
    folder_id: 1,
    kind: "regular",
    status: "completed",
    agent_type: "codex",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  } as DbConversationSummary
  const view = (
    <NextIntlClientProvider locale="en" messages={en}>
      <ConversationLab />
    </NextIntlClientProvider>
  )
  try {
    localStorage.setItem(labKey(c), String(Date.now() + 1000))
    useAppWorkspaceStore.setState({
      conversations: [c],
      conversationsLoading: false,
    })
    const { unmount } = render(view)
    expect(screen.queryByText("Woke up")).toBeNull()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(
      screen.getByRole("button", { name: "Dismiss wake notification" })
    ).toBeTruthy()
    unmount()
    render(view)
    const dismiss = screen.getByRole("button", {
      name: "Dismiss wake notification",
    })
    fireEvent.click(dismiss)
    expect(localStorage.getItem(labKey(c))).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Dismiss wake notification" })
    ).toBeNull()
  } finally {
    localStorage.removeItem(labKey(c))
    useAppWorkspaceStore.setState(previous)
    vi.useRealTimers()
  }
})

it("filters projects by name and keeps Shift selections in the open picker", async () => {
  const previous = useAppWorkspaceStore.getState()
  const allFolders = [
    { id: 91, name: "Alpha", path: "/alpha" },
    { id: 92, name: "Bravo", path: "/bravo" },
  ] as FolderDetail[]
  const conversations = allFolders.map((f) => ({
    id: f.id,
    folder_id: f.id,
    agent_type: "codex",
    title: f.name + " chat",
    status: "completed",
    kind: "regular",
    updated_at: "2026-11-10",
    created_at: "2026-11-10",
  })) as DbConversationSummary[]
  useAppWorkspaceStore.setState({ allFolders, conversations })
  try {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab />
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Filter by project" }))
    const input = await screen.findByRole("combobox")
    const all = screen.getByRole("button", { name: "All projects" })
    expect(
      all.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(input.parentElement?.querySelector("svg")).toBeNull()
    fireEvent.change(input, { target: { value: "Alp" } })
    expect(screen.queryByRole("option", { name: "Bravo" })).toBeNull()
    const option = screen.getByRole("option", { name: "Alpha" })
    fireEvent.pointerDown(option, { shiftKey: true })
    fireEvent.click(option, { shiftKey: true })
    expect(
      screen
        .getByRole("button", { name: "Filter by project · Alpha" })
        .querySelector("text")?.textContent
    ).toBe("AA")
    expect(screen.queryByText("Bravo chat")).toBeNull()
    expect(screen.getByRole("combobox")).toBe(input)
    fireEvent.change(input, { target: { value: "Bra" } })
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(
      Array.from(
        screen
          .getByRole("button", { name: "Filter by project · Alpha · Bravo" })
          .querySelectorAll("text"),
        (el) => el.textContent
      )
    ).toEqual(["AA", "BO"])
    expect(screen.getByText("Bravo chat")).toBeTruthy()
    expect(screen.getByText("Alpha chat")).toBeTruthy()
    expect(screen.getByRole("combobox")).toBeTruthy()
  } finally {
    useAppWorkspaceStore.setState(previous)
  }
})

it("updates the project badge tint in the list, filter, and search after the folder color changes", async () => {
  const previous = useAppWorkspaceStore.getState()
  const folder = {
    id: 93,
    name: "Project",
    path: "/project",
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-11-10",
    sort_order: 0,
    color: "inherit",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
  } satisfies FolderDetail
  const conversation = {
    id: 93,
    folder_id: folder.id,
    agent_type: "codex",
    title: "Project session",
    status: "completed",
    kind: "regular",
    updated_at: "2026-11-10",
    created_at: "2026-11-10",
  } as DbConversationSummary
  const getFolder = vi.spyOn(api, "getFolder")
  useAppWorkspaceStore.setState({
    allFolders: [folder],
    conversations: [conversation],
    conversationsLoading: false,
  })
  try {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab />
      </NextIntlClientProvider>
    )
    const row = screen.getByRole("button", { name: /Project session/ })
    const autoColor = row.querySelector("svg")?.getAttribute("class")
    fireEvent.click(screen.getByRole("button", { name: "Filter by project" }))
    fireEvent.click(await screen.findByRole("option", { name: "Project" }))
    const filter = screen.getByRole("button", {
      name: "Filter by project · Project",
    })

    getFolder.mockResolvedValue({ ...folder, color: "blue" })
    await act(() => useAppWorkspaceStore.getState().refreshFolder(folder.id))
    const expectBlueBadge = (element: HTMLElement) => {
      const badge = element.querySelector("svg")
      expect(badge).toHaveClass("folder-title-tint", "bg-current/14")
      expect(badge).toHaveStyle({
        "--folder-title-light": "oklch(0.5 0.245 262.881)",
        "--folder-title-dark": "oklch(0.8 0.1 259.815)",
      })
    }
    expectBlueBadge(row)
    expectBlueBadge(filter)

    fireEvent.click(filter)
    expectBlueBadge(await screen.findByRole("option", { name: /Project/ }))
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" })
    const search = screen.getByRole("searchbox")
    fireEvent.change(search, { target: { value: "Project session" } })
    expectBlueBadge(screen.getByRole("option", { name: /Project session/ }))

    getFolder.mockResolvedValue(folder)
    await act(() => useAppWorkspaceStore.getState().refreshFolder(folder.id))
    fireEvent.change(search, { target: { value: "" } })
    expect(
      screen
        .getByRole("button", { name: /Project session/ })
        .querySelector("svg")
    ).toHaveAttribute("class", autoColor)
  } finally {
    getFolder.mockRestore()
    useAppWorkspaceStore.setState(previous)
  }
})

it.each([
  ["律总管", "律", "11"],
  ["AI外呼", "AI", "9"],
  ["MaxCode", "ME", "9"],
  ["A", "A", "9"],
])("fits the label for %s in the shared badge", (name, initials, size) => {
  const { container } = render(<LabProjectBadge name={name} />)
  const label = container.querySelector("text")
  expect(label).toHaveTextContent(initials)
  expect(label?.textContent).toBe(initials)
  expect(label).toHaveAttribute("font-size", size)
  expect(label).not.toHaveAttribute("textLength")
  expect(container.querySelector("svg")).toHaveClass("size-4")
})

it("renders the project initials and stable color for mixed-language names", () => {
  const { container, rerender } = render(
    <LabProjectBadge name="GKD-青桔定制" />
  )
  expect(container.querySelector("text")?.textContent).toBe("GK")
  expect(
    container.querySelector("svg")?.classList.contains("text-blue-600")
  ).toBe(true)
  const frame = container.querySelector("svg")
  rerender(<LabProjectBadge name={null} />)
  expect(container.querySelector("svg")).toBe(frame)
  expect(frame?.getAttribute("viewBox")).toBe("0 0 16 16")
  expect(frame?.querySelector('path[fill="currentColor"]')).toBeTruthy()
  expect(container.querySelector("text")).toBeNull()
})

it("applies the shared local time range before listing and searching lab conversations", () => {
  const previous = useAppWorkspaceStore.getState()
  const saved = localStorage.getItem(DATE_FILTER_STORAGE_KEY)
  localStorage.setItem(
    DATE_FILTER_STORAGE_KEY,
    JSON.stringify({
      preset: "custom",
      start: "2026-11-10",
      end: "2026-11-10",
      startTime: "09:00:00",
      endTime: "10:00:59",
      range: true,
    })
  )
  const conversations = ["08:59:59", "09:00:00", "10:00:59", "10:01:00"].map(
    (time, id) => ({
      id: id + 1,
      kind: "chat",
      agent_type: "codex",
      title: "Thread " + time,
      status: "completed",
      created_at: "2026-11-01",
      updated_at: "2026-11-10T" + time,
    })
  ) as DbConversationSummary[]
  useAppWorkspaceStore.setState({ conversations })
  try {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarNavigationProvider>
          <ConversationLab />
        </SidebarNavigationProvider>
      </NextIntlClientProvider>
    )
    expect(screen.getAllByText(/^Thread /).map((e) => e.textContent)).toEqual([
      "Thread 10:00:59",
      "Thread 09:00:00",
    ])
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Thread" },
    })
    expect(screen.getAllByRole("option")).toHaveLength(2)
  } finally {
    useAppWorkspaceStore.setState(previous)
    if (saved === null) localStorage.removeItem(DATE_FILTER_STORAGE_KEY)
    else localStorage.setItem(DATE_FILTER_STORAGE_KEY, saved)
  }
})

vi.mock("@/contexts/todos-view-context", () => ({
  useOptionalTodosView: () => ({ state: { mode: "personal" } }),
}))

it("offers standard conversation actions and confirms deletion on the selected row", async () => {
  const previous = useAppWorkspaceStore.getState()
  const c = {
    id: 901,
    title: "Menu target",
    folder_id: 5,
    kind: "regular",
    status: "pending_review",
    agent_type: "codex",
    created_at: "2026-11-24",
    updated_at: "2026-11-24",
  } as DbConversationSummary
  useAppWorkspaceStore.setState({
    conversations: [c],
    conversationsLoading: false,
  })
  try {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab />
      </NextIntlClientProvider>
    )
    fireEvent.contextMenu(screen.getByText("Menu target"))
    const items = await screen.findAllByRole("menuitem")
    expect(
      items.some((item) =>
        item.textContent?.includes(en.Folder.sidebar.lab.filter)
      )
    ).toBe(false)
    for (const item of items)
      expect(item.firstElementChild?.tagName).toBe("svg")
    for (const name of [
      en.Folder.conversationCard.markCompleted,
      en.Todos.linkConversation,
      en.Folder.sessionDetails.menuLabel,
    ]) {
      expect(await screen.findByRole("menuitem", { name })).toBeTruthy()
    }
    fireEvent.click(
      screen.getByRole("menuitem", { name: en.Folder.conversationCard.delete })
    )
    expect((await screen.findByRole("alertdialog")).textContent).toContain(
      "Menu target"
    )
    fireEvent.click(
      screen.getByRole("button", { name: en.Folder.conversationCard.cancel })
    )
    expect(useAppWorkspaceStore.getState().conversations).toContain(c)
    const status = vi
      .spyOn(api, "updateConversationStatus")
      .mockResolvedValue(undefined)
    try {
      fireEvent.contextMenu(screen.getByText("Menu target"))
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: en.Folder.conversationCard.markCompleted,
        })
      )
      await waitFor(() =>
        expect(useAppWorkspaceStore.getState().conversations[0].status).toBe(
          "completed"
        )
      )
      expect(status).toHaveBeenCalledWith(c.id, "completed")
      expect(localStorage.getItem(labKey(c))).toBeNull()
    } finally {
      status.mockRestore()
    }
  } finally {
    useAppWorkspaceStore.setState(previous)
  }
})

it("uses actual requests and terminal failures for priority and early wake", async () => {
  const { labConnectionSignal, shouldWakeLabSnooze } =
    await import("@/lib/conversation-lab-status")
  const conn = {
    status: "prompting",
    connectionId: "agent",
    pendingQuestion: { tool_call_id: "q" },
    sessionFailures: [],
  } as unknown as import("@/contexts/acp-connections-context").ConnectionState
  const question = labConnectionSignal(conn)
  expect(question?.kind).toBe("input")
  expect(shouldWakeLabSnooze(question, question?.edge)).toBe(false)
  expect(shouldWakeLabSnooze(question, "older")).toBe(true)
  const approval = labConnectionSignal({
    ...conn,
    pendingPermission: { request_id: "p", options: [], tool_call: null },
  })
  expect(approval?.kind).toBe("approval")
  const failed = labConnectionSignal({
    ...conn,
    status: "error",
    pendingQuestion: null,
    sessionFailures: [
      { id: "f", revision: 1, category: "limit", severity: "error", title: "" },
    ],
  })
  expect(failed?.kind).toBe("limited")
  expect(shouldWakeLabSnooze(failed, failed?.edge)).toBe(false)
  expect(
    shouldWakeLabSnooze(
      labConnectionSignal({ ...conn, pendingQuestion: null }),
      undefined
    )
  ).toBe(false)
})

it("returns a snoozed parent for a child approval and dismisses the wake without opening it", () => {
  const previous = useAppWorkspaceStore.getState()
  const tabs = tabStore.getState().rawTabs
  const parent = {
    id: 790,
    title: "Parent",
    kind: "regular",
    agent_type: "codex",
    status: "completed",
    created_at: "2026-11-15",
    updated_at: "2026-11-24",
  } as DbConversationSummary
  const child = {
    ...parent,
    id: 791,
    parent_id: 790,
    kind: "delegate" as const,
  }
  const childKey = "child-791"
  localStorage.setItem(labKey(parent), String(Date.now() + 3600000))
  useAppWorkspaceStore.setState({ conversations: [parent, child] })
  tabStore.setState({ rawTabs: [] })
  try {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationLab />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("Snoozed")).toBeTruthy()
    act(() => {
      live.connections.set(childKey, {
        status: "prompting",
        connectionId: childKey,
        pendingPermission: { request_id: "p" },
      } as ConnectionState)
      live.listeners.get(childKey)?.()
    })
    expect(screen.getByText("Approval")).toBeTruthy()
    expect(screen.queryByText("Snoozed")).toBeNull()
    expect(screen.queryByRole("button", { name: "Snooze thread" })).toBeNull()
    act(() => {
      live.connections.delete(childKey)
      live.listeners.get(childKey)?.()
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss wake notification" })
    )
    expect(localStorage.getItem(labKey(parent))).toBeNull()
    expect(live.connections.size).toBe(0)
    unmount()
  } finally {
    localStorage.removeItem(labKey(parent))
    live.connections.clear()
    tabStore.setState({ rawTabs: tabs })
    useAppWorkspaceStore.setState(previous)
  }
})

it("uses the shared sidebar scrollbar for the list, search and shelves", () => {
  const lab = source("src/components/conversations/conversation-lab.tsx")
  expect(lab.match(/<ScrollArea\b/g)).toHaveLength(3)
  expect(lab).not.toMatch(/overflow-(?:y-)?auto/)
})

it("formats live run time in seconds, then minutes, then hours plus minutes", async () => {
  const { formatLabWorkingDuration } = await import("@/lib/conversation-lab")
  for (const [seconds, expected] of [
    [-1, "0s"],
    [0, "0s"],
    [59.999, "59s"],
    [60, "1m"],
    [3599, "59m"],
    [3600, "1h 0m"],
    [7500, "2h 5m"],
  ] as const) {
    expect(formatLabWorkingDuration(seconds * 1000, "en")).toBe(expected)
  }
})
