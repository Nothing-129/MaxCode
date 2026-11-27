import { beforeEach, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import {
  persistedSelectorPreview,
  useConversationSelectorPreview,
} from "@/hooks/use-conversation-selector-preview"
import {
  getSavedPrefsForConnect,
  saveConfigPreference,
  saveModePreference,
} from "@/lib/selector-prefs-storage"
import { updateCachedSelectors } from "@/lib/selectors-cache-storage"

beforeEach(() => localStorage.clear())

it("shows the conversation's server-saved permission over an older device preview", () => {
  const autoReview = {
    id: "mode",
    name: "Permission",
    category: "mode",
    kind: {
      type: "select" as const,
      current_value: "agent",
      options: [
        { value: "agent", name: "Auto review" },
        { value: "agent-full-access", name: "Full access" },
      ],
      groups: [],
    },
  }
  updateCachedSelectors("codex", { configOptions: [autoReview] })
  const live = {
    agentType: "codex",
    workingDir: "/project",
    conversationId: 42,
    ready: true,
    configOptions: [autoReview],
    persistedValues: { mode: "agent" },
  }
  const oldView = renderHook(useConversationSelectorPreview, {
    initialProps: live,
  })
  oldView.unmount()
  const phone = renderHook(useConversationSelectorPreview, {
    initialProps: {
      ...live,
      ready: false,
      persistedValues: { mode: "agent-full-access" },
    },
  })
  expect(phone.result.current).toMatchObject([
    {
      id: "mode",
      kind: {
        current_value: "agent-full-access",
        options: [{ value: "agent-full-access", name: "Full access" }],
      },
    },
  ])
})

it("uses recent permission defaults only for new conversations, including slow reconnects", () => {
  for (const agent of [
    "codex",
    "claude_code",
    "grok",
    "pi",
    "deepseek",
    "antigravity",
    "zcode",
  ]) {
    saveModePreference(agent, {
      current_mode_id: "full-access",
      available_modes: [],
    })
    for (const id of [
      "mode",
      "approval_policy",
      "sandbox",
      "permission_mode",
      "permission-mode",
      "auto_approve",
    ]) {
      saveConfigPreference(agent, id, "permissive")
    }
    saveConfigPreference(agent, "unrelated-option", "keep")
    expect(getSavedPrefsForConnect(agent).modeId).toBe("full-access")
    expect(getSavedPrefsForConnect(agent).configValues?.mode).toBe("permissive")
    expect(getSavedPrefsForConnect(agent, true)).toEqual({
      modeId: null,
      configValues: { "unrelated-option": "keep" },
    })
    saveConfigPreference(agent, "mode", "another-tab-value")
    expect(getSavedPrefsForConnect(agent, true).configValues).toEqual({
      "unrelated-option": "keep",
    })
  }
})

it("recognizes adapter permission ids by category when excluding global defaults", () => {
  updateCachedSelectors("codex", {
    configOptions: [
      {
        id: "custom-approval",
        name: "Approval",
        category: "permission",
        kind: { type: "boolean", current_value: true },
      },
    ],
  })
  saveConfigPreference("codex", "custom-approval", "true")
  expect(getSavedPrefsForConnect("codex", true).configValues).toBeNull()
})

it("previews saved permission values with their correct kind and category", () => {
  const preview = persistedSelectorPreview(
    { mode: "read-only", auto_approve: "false", $session_mode: "default" },
    [
      {
        id: "auto_approve",
        name: "Auto approve",
        category: "permission",
        kind: { type: "boolean", current_value: true },
      },
    ]
  )
  expect(preview?.find((o) => o.id === "mode")).toMatchObject({
    category: "mode",
    kind: { current_value: "read-only" },
  })
  expect(preview?.find((o) => o.id === "auto_approve")?.kind).toEqual({
    type: "boolean",
    current_value: false,
  })
  expect(preview?.some((o) => o.id === "$session_mode")).toBe(false)
})

it("previews the saved standard mode without showing internal metadata", () => {
  expect(
    persistedSelectorPreview({ $session_mode: "default" }, null, {
      current_mode_id: "bypassPermissions",
      available_modes: [{ id: "default", name: "Ask first" }],
    })
  ).toMatchObject([
    {
      id: "mode",
      category: "mode",
      kind: {
        current_value: "default",
        options: [{ value: "default", name: "Ask first" }],
      },
    },
  ])
})

it("uses the saved standard mode when a mode-only adapter cached no config options", () => {
  const props = {
    agentType: "claude_code",
    workingDir: "/tmp/mode-only",
    conversationId: 1,
    ready: true,
    configOptions: [],
    persistedValues: { $session_mode: "default" },
  }
  const hook = renderHook(useConversationSelectorPreview, {
    initialProps: props,
  })
  hook.rerender({ ...props, ready: false })
  expect(hook.result.current).toMatchObject([
    { id: "mode", kind: { current_value: "default" } },
  ])
})
