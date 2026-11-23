import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TerminalView } from "@/components/terminal/terminal-view"

const h = vi.hoisted(() => ({
  subscribe: vi.fn(),
  dispose: vi.fn(),
  spawn: vi.fn(),
  kill: vi.fn(),
  unlisten: vi.fn(),
}))

vi.mock("@/lib/platform", () => ({ subscribe: h.subscribe }))
vi.mock("@/lib/api", () => ({
  terminalSpawn: h.spawn,
  terminalKill: h.kill,
  terminalResize: vi.fn(),
  terminalWrite: vi.fn(),
}))
vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100 }),
  useTerminalFont: () => ({ terminalFontSize: 14, terminalLigatures: false }),
}))
vi.mock("@xterm/addon-ligatures", () => ({}))
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {}
    open() {}
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    onData() {
      return { dispose() {} }
    }
    onResize() {
      return { dispose() {} }
    }
    dispose() {
      h.dispose()
    }
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function terminal() {
  return (
    <TerminalView
      terminalId="test-pty"
      workingDir="/tmp"
      isActive={false}
      isVisible={false}
    />
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  h.subscribe.mockResolvedValue(h.unlisten)
  h.kill.mockResolvedValue(undefined)
})

describe("terminal cleanup while opening", () => {
  it("disposes the view immediately and removes a subscription that resolves late", async () => {
    const subscription = deferred<() => void>()
    h.subscribe.mockReturnValueOnce(subscription.promise)
    const view = render(terminal())
    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1))
    view.unmount()
    expect(h.dispose).toHaveBeenCalledTimes(1)
    await act(async () => subscription.resolve(h.unlisten))
    expect(h.unlisten).toHaveBeenCalledTimes(1)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it("releases the view immediately and kills a PTY spawned after it closes", async () => {
    const spawn = deferred<void>()
    h.spawn.mockReturnValueOnce(spawn.promise)
    const view = render(terminal())
    await waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1))
    view.unmount()
    expect(h.dispose).toHaveBeenCalledTimes(1)
    expect(h.unlisten).toHaveBeenCalledTimes(2)
    await act(async () => spawn.resolve(undefined))
    expect(h.kill).toHaveBeenCalledExactlyOnceWith("test-pty")
    expect(h.dispose).toHaveBeenCalledTimes(1)
  })
})
