import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"
import { ConversationDetailHeader } from "@/components/conversations/conversation-detail-header"
import enMessages from "@/i18n/messages/en.json"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { resetTabStore, useTabStore } from "@/stores/tab-store"

const project = { name: "worktree-dir", alias: "Project alias", color: "blue" }

function renderHeader() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConversationDetailHeader
        tabId="open-conversation"
        conversationId={8}
        runtimeConversationId={null}
        folderId={27}
        folderPath="/repos/worktree-dir"
        project={project}
        title="Current conversation"
      />
    </NextIntlClientProvider>
  )
}

describe("MaxCode contract: conversation header project action", () => {
  afterEach(() => {
    resetTabStore()
    resetAppWorkspaceStore()
    localStorage.clear()
  })

  it.each(["click", "keyboard", "title"] as const)(
    "opens a draft in the displayed conversation's folder via %s",
    async (method) => {
      useAppWorkspaceStore.setState({ activeFolderId: 99 })
      const user = userEvent.setup()
      renderHeader()

      if (method === "title") {
        await user.click(screen.getByText("Current conversation"))
      } else {
        const button = screen.getByRole("button", { name: /Project alias/ })
        if (method === "click") {
          await user.click(button)
        } else {
          await user.tab()
          expect(button).toHaveFocus()
          await user.keyboard("{Enter}")
        }
      }

      const { activeTabId, tabs } = useTabStore.getState()
      expect(tabs.find((tab) => tab.id === activeTabId)).toMatchObject({
        conversationId: null,
        folderId: 27,
        workingDir: "/repos/worktree-dir",
      })
    }
  )
})
