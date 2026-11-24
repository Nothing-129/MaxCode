import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { ConversationTitleLabel } from "../components/conversations/conversation-title-label"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (path: string) =>
  readFileSync(`src/components/${path}.tsx`, "utf8")

describe("conversation header layout", () => {
  it("omits the standalone header compose button and keeps settings in sidebar tools", () => {
    expect(source("layout/left-edge-chrome")).not.toContain('name="compose"')
    expect(source("layout/sidebar")).toContain("openSettingsWindow()")
    expect(source("layout/right-edge-chrome")).not.toContain('name="terminal"')
    expect(source("layout/right-edge-chrome")).not.toContain(
      "openSettingsWindow"
    )
  })
  it("keeps compact titles without a todo subtitle", () => {
    expect(source("conversations/conversation-detail-header")).toContain(
      "flex-col items-center justify-center"
    )
    expect(source("conversations/conversation-detail-header")).toContain(
      "truncate text-[15px] leading-[18px] font-medium"
    )
    expect(source("conversations/conversation-detail-header")).not.toContain(
      "ConversationTodoSourceBadges"
    )
  })
})

it("anchors navigation inside the conversation main panel", () => {
  const layout = readFileSync("src/app/workspace/layout.tsx", "utf8")
  const main = layout.slice(
    layout.indexOf("ref={mainContainerRef}"),
    layout.indexOf("</main>", layout.indexOf("ref={mainContainerRef}"))
  )
  expect(main).toContain("data-conversation-navigation")
  expect(main).toContain("<LeftEdgeChrome />")
  expect(main).toContain("<RightEdgeChrome />")
  expect(main).toContain('WebkitAppRegion: "no-drag"')
  expect(source("conversations/conversation-detail-header")).not.toMatch(
    /data-drag-region\s+className="relative flex h-14/
  )
  expect(source("layout/aux-panel")).toContain('!showFolderTabs && "hidden"')
})

it("omits the date in header titles", () => {
  const props = { title: "1030｜其他｜未命名", fallback: "新对话" }
  const header = renderToStaticMarkup(
    createElement(ConversationTitleLabel, props)
  )
  expect(header).toContain("未命名")
  expect(header).not.toContain("1030")
})

it("lets pointer input pass through unused right chrome to the conversation menu", () => {
  const chrome = source("layout/right-edge-chrome")
  expect(chrome).toContain("pointer-events-none")
  expect(chrome).toContain("[&_button]:pointer-events-auto")
  expect(chrome).not.toContain("data-drag-region")
  expect(chrome).not.toContain("rightChromeClusterWidth")
})
it("omits new conversation from the conversation header tools", () => {
  const header = source("conversations/conversation-detail-header")
  const menu = header.slice(
    header.indexOf("const conversationMenuItems"),
    header.indexOf("const header =")
  )
  expect(menu).not.toContain('t("newConversation")')
  expect(menu).not.toContain("openNewConversationTab")
})
