import { fireEvent, render, screen, within } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { useState } from "react"
import { expect, it, vi } from "vitest"
import { CodexComposerSettings } from "@/components/chat/codex-composer-settings"
import type { SessionSelectorSetting } from "@/components/chat/session-selectors-panel"
import messages from "@/i18n/messages/en.json"

function setting(
  title: string,
  options: { value: string; name: string; description?: string }[],
  currentValue: string,
  onSelect: (value: string) => void
): SessionSelectorSetting {
  return {
    key: title,
    title,
    currentValue,
    currentLabel: options.find((option) => option.value === currentValue)!.name,
    groups: [{ key: title, name: null, options }],
    onSelect,
  }
}

function ConversationSettings() {
  const [model, setModel] = useState("sol")
  const [effort, setEffort] = useState("low")
  const [speed, setSpeed] = useState("off")
  const [permission, setPermission] = useState("workspace")
  return (
    <CodexComposerSettings
      model={setting(
        "Model",
        [
          { value: "sol", name: "GPT-6.2-Sol" },
          { value: "astra", name: "GPT-6.2-Astra" },
          ...Array.from({ length: 6 }, (_, i) => ({
            value: `old-${i}`,
            name: `Older model ${i}`,
            description: "Older generation",
          })),
        ],
        model,
        setModel
      )}
      reasoning={{
        ...setting(
          "Reasoning",
          [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
            { value: "xhigh", name: "Xhigh" },
          ],
          effort,
          setEffort
        ),
        recommendedValue: "low",
      }}
      speed={setting(
        "Speed",
        [
          { value: "off", name: "Off" },
          { value: "on", name: "On" },
        ],
        speed,
        setSpeed
      )}
      legacyFast
      permission={setting(
        "Permissions",
        [
          { value: "workspace", name: "Workspace" },
          {
            value: "agent-full-access",
            name: "Full access",
            description: "Can access all files",
          },
        ],
        permission,
        setPermission
      )}
    />
  )
}

it("shows searchable models and keeps the composer summary in sync while keeping permissions inside the picker", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConversationSettings />
    </NextIntlClientProvider>
  )
  const trigger = screen.getByRole("button", {
    name: "6.2 Sol · Low",
  })
  expect(trigger).toHaveTextContent(/^6\.2 Sol · Low$/)
  expect(trigger.querySelector(".lucide-zap")).toBeNull()
  expect(trigger).toHaveClass(
    "bg-transparent",
    "hover:bg-interaction-hover",
    "text-muted-foreground",
    "font-medium",
    "hover:text-foreground"
  )
  expect(screen.queryByRole("button", { name: /Permissions:/ })).toBeNull()
  fireEvent.click(trigger)
  const panel = screen.getByRole("dialog")
  const speedControl = within(panel).getByRole("group", { name: "Speed" })
  expect(speedControl).not.toHaveClass("border")
  const speedFooter = speedControl.parentElement
  expect(speedFooter).toHaveClass("mt-1.5", "pt-2")
  expect(panel).toHaveClass("pb-2", "w-[min(30rem,calc(100vw-1rem))]")
  fireEvent.click(within(panel).getByRole("button", { name: "Older model 5" }))
  expect(trigger).toHaveTextContent("Older model 5")
  expect(
    within(panel).queryByRole("button", { name: /Older models/ })
  ).toBeNull()
  const search = within(panel).getByRole("searchbox")
  const searchHeading = search.closest("label")
  const reasoningHeading = within(panel).getByRole("region", {
    name: "Reasoning",
  }).firstElementChild
  expect(reasoningHeading).toHaveTextContent(/^Older model 5$/)
  for (const heading of [searchHeading, reasoningHeading]) {
    expect(heading).toHaveClass("h-9", "border-b", "border-border")
  }
  expect(searchHeading).not.toHaveClass("focus-within:border-ring")
  fireEvent.change(search, { target: { value: "older model 5" } })
  expect(
    within(panel).getByRole("button", { name: "Older model 5" })
  ).toBeVisible()
  fireEvent.change(search, { target: { value: "astra" } })
  fireEvent.click(within(panel).getByRole("button", { name: "6.2 Astra" }))
  expect(
    within(panel).getByRole("button", { name: /Low.*Recommended/ })
  ).toHaveAttribute("aria-pressed", "true")
  for (const name of ["6.2 Astra", "Xhigh"]) {
    const option = within(panel).getByRole("button", { name })
    expect(option).toBeVisible()
    expect(option).not.toHaveClass("border")
    expect(option).toHaveClass("aria-pressed:bg-accent")
  }
  fireEvent.click(within(panel).getByRole("button", { name: "High" }))
  expect(
    within(panel).getByRole("button", { name: "Standard" })
  ).toHaveAttribute("aria-pressed", "true")
  const fast = within(panel).getByRole("button", { name: "Fast" })
  expect(fast.querySelector(".lucide-zap")).toHaveAttribute("fill", "none")
  expect(fast.querySelector(".lucide-zap")).toHaveAttribute(
    "stroke-width",
    "1.5"
  )
  expect(
    within(panel)
      .getByRole("button", { name: "Standard" })
      .querySelector(".lucide-zap")
  ).toBeNull()
  fireEvent.click(fast)
  expect(within(panel).getByRole("button", { name: "Fast" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  expect(within(panel).queryByRole("button", { name: "Ultrafast" })).toBeNull()
  const permissionControl = within(panel).getByRole("button", {
    name: "Permissions: Workspace",
  })
  expect(permissionControl).not.toHaveClass("border")
  fireEvent.click(permissionControl)
  const permissionMenu = screen.getByRole("dialog", { name: "Permissions" })
  expect(panel).not.toContainElement(permissionMenu)
  expect(permissionMenu).toHaveClass("overflow-y-auto")
  const fullAccess = within(permissionMenu).getByRole("button", {
    name: "Full access",
    pressed: false,
  })
  expect(fullAccess).toHaveClass("shrink-0", "min-h-12")
  expect(fullAccess.querySelector(".lucide-shield-alert")).toBeInTheDocument()
  fireEvent.click(fullAccess)
  expect(screen.queryByRole("dialog", { name: "Permissions" })).toBeNull()
  expect(panel).toBeVisible()
  expect(
    within(panel)
      .getByRole("button", { name: "Permissions: Full access" })
      .querySelector(".lucide-shield-alert")
  ).toBeInTheDocument()
  expect(trigger).toHaveTextContent(/^6\.2 Astra · High$/)
  expect(trigger.querySelector(".lucide-zap")).toHaveAttribute("fill", "none")
  expect(trigger.querySelector(".lucide-zap")).toHaveAttribute(
    "stroke-width",
    "1.5"
  )
  expect(trigger).toHaveAccessibleName("6.2 Astra · High · Fast")
  expect(trigger).not.toHaveTextContent("Full access")
  fireEvent.keyDown(search, { key: "Escape" })
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.queryByRole("button", { name: /Permissions:/ })).toBeNull()
})

it("hides an advertised Ultrafast tier without changing the saved speed", () => {
  const onSelect = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CodexComposerSettings
        model={setting(
          "Model",
          [{ value: "sol", name: "6.2 Sol" }],
          "sol",
          onSelect
        )}
        speed={setting(
          "Speed",
          [
            { value: "normal", name: "Standard" },
            { value: "priority", name: "Fast" },
            { value: "ultra_fast", name: "Ultrafast" },
          ],
          "ultra_fast",
          onSelect
        )}
      />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "6.2 Sol" }))
  const panel = within(screen.getByRole("dialog"))
  expect(panel.queryByRole("button", { name: "Ultrafast" })).toBeNull()
  expect(panel.getByRole("button", { name: "Standard" })).toHaveAttribute(
    "aria-pressed",
    "false"
  )
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.click(panel.getByRole("button", { name: "Fast" }))
  expect(onSelect).toHaveBeenCalledWith("priority")
})
