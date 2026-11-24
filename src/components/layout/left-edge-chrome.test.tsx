import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LeftEdgeChrome } from "./left-edge-chrome"
import enMessages from "@/i18n/messages/en.json"

const spies = vi.hoisted(() => ({
  isSidebarOpen: true,
  routeId: "conversations",
  toggleSidebar: vi.fn(),
  setRoute: vi.fn(),
}))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({
    isOpen: spies.isSidebarOpen,
    toggle: spies.toggleSidebar,
  }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => spies,
}))
vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100 }),
}))
vi.mock("@/hooks/use-is-mac", () => ({ useIsMac: () => false }))
vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({ isMac: false }),
}))
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({ shortcuts: { toggle_sidebar: "mod+b" } }),
}))
vi.mock("@/lib/platform", () => ({ isNativeDesktop: () => true }))

function renderChrome() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeftEdgeChrome />
    </NextIntlClientProvider>
  )
}

describe("LeftEdgeChrome", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spies.isSidebarOpen = true
    spies.routeId = "conversations"
  })
  it("leaves the header's left edge clear when the sidebar is open", () => {
    renderChrome()
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("retains the task board return action in linked conversations", () => {
    spies.routeId = "taskConversation"
    renderChrome()
    fireEvent.click(
      screen.getByRole("button", {
        name: enMessages.Folder.sidebar.navigation.todoBoard,
      })
    )
    expect(spies.setRoute).toHaveBeenCalledWith("tasks")
  })
  it("shows a sidebar toggle and its shortcut when the sidebar is collapsed", () => {
    spies.isSidebarOpen = false
    renderChrome()
    const toggle = screen.getByRole("button", { name: "Show Sidebar" })
    expect(toggle).toHaveAttribute("title", "Show Sidebar (Ctrl+B)")
    fireEvent.click(toggle)
    expect(spies.toggleSidebar).toHaveBeenCalledOnce()
    expect(screen.getAllByRole("button")).toEqual([toggle])
  })
})
