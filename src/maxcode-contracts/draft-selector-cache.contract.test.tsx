import { act, renderHook } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { afterEach, expect, it, vi } from "vitest"
import {
  AcpConnectionsProvider,
  useAcpActions,
} from "@/contexts/acp-connections-context"
import { useConnection } from "@/hooks/use-connection"
import { resetSelectorsCache } from "@/lib/selectors-cache-storage"
import type { AttachHandlers } from "@/lib/transport/types"
import type { LiveSessionSnapshot } from "@/lib/types"

const transport = vi.hoisted(() => ({
  attach: vi.fn<
    (
      id: string,
      seq: number | undefined,
      handlers: AttachHandlers
    ) => {
      detach: () => void
    }
  >(() => ({ detach: vi.fn() })),
  connect: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock("@/contexts/alert-context", () => ({
  useAlertContext: () => ({ pushAlert: vi.fn() }),
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: null }),
}))
vi.mock("@/lib/platform", () => ({
  getEventStream: () => ({ attach: transport.attach }),
}))
vi.mock("@/lib/api", () => ({
  acpGetAgentStatus: async () => ({
    agent_type: "codex",
    enabled: true,
    available: true,
    installed_version: "1.0.0",
    is_acp_adapter: true,
  }),
  acpConnect: transport.connect,
  acpDisconnect: async () => {},
}))

afterEach(() => {
  localStorage.removeItem("codeg:selectors-cache:v1")
  resetSelectorsCache()
})

function Wrapper({ children }: PropsWithChildren) {
  return <AcpConnectionsProvider>{children}</AcpConnectionsProvider>
}

it("shows the previous snapshot's model and thinking level while a new draft connects", async () => {
  const snapshot: LiveSessionSnapshot = {
    connection_id: "first-connection",
    conversation_id: null,
    folder_id: null,
    status: "connected",
    external_id: "first-session",
    live_message: null,
    active_tool_calls: [],
    pending_permission: null,
    modes: null,
    current_mode: null,
    config_options: [
      {
        id: "model",
        name: "Model",
        category: "model",
        kind: {
          type: "select",
          groups: [],
          current_value: "gpt-5.4",
          options: [{ value: "gpt-5.4", name: "GPT-5.4" }],
        },
      },
      {
        id: "reasoning_effort",
        name: "Thinking level",
        category: "thought_level",
        kind: {
          type: "select",
          groups: [],
          current_value: "high",
          options: [{ value: "high", name: "High" }],
        },
      },
    ],
    prompt_capabilities: null,
    usage: null,
    fork_supported: false,
    available_commands: [],
    selectors_ready: true,
    event_seq: 5,
  }

  transport.connect.mockResolvedValueOnce("first-connection")
  const first = renderHook(() => useAcpActions(), { wrapper: Wrapper })
  await act(async () => {
    await first.result.current.connect("first", "codex", "/workspace")
  })
  const handlers = transport.attach.mock.calls[0][2]
  act(() => handlers.onSnapshot(snapshot, snapshot.event_seq))
  first.unmount()

  // Simulate a renderer restart: the next draft has only the persisted catalog.
  resetSelectorsCache()
  const next = renderHook(
    () => ({ actions: useAcpActions(), draft: useConnection("next") }),
    { wrapper: Wrapper }
  )
  act(() =>
    next.result.current.actions.markConnectPending(
      "next",
      "codex",
      "/workspace"
    )
  )

  expect(next.result.current.draft.status).toBe("connecting")
  expect(next.result.current.draft.selectorsReady).toBe(false)
  expect(next.result.current.draft.configOptions).toEqual(
    snapshot.config_options
  )
})
