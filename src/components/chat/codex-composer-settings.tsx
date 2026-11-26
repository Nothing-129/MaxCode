"use client"

import { useState } from "react"
import { Check, ChevronDown, Search, ShieldAlert, Zap } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { isFullAccessPermission } from "@/lib/permission-config"
import { ScrollArea } from "@/components/ui/scroll-area"
import { isImeCompositionKey } from "@/lib/ime-composition"
import { useScrollbarSafeDismiss } from "@/hooks/use-scrollbar-safe-dismiss"
import type { SessionSelectorSetting } from "./session-selectors-panel"

const composerControlTone =
  "font-medium text-muted-foreground hover:text-foreground"
const pickerColumnHeading = "mb-2 flex h-9 items-center border-b border-border"

const speedOptions = [
  {
    name: "Standard",
    values: ["off", "false", "standard", "default", "normal"],
  },
  { name: "Fast", values: ["on", "true", "fast", "priority"] },
]

function modelDisplayLabel(label: string) {
  if (!/^gpt-/i.test(label)) return label
  return label
    .replace(/^gpt-/i, "")
    .split(/[-/]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function settingOptions(setting?: SessionSelectorSetting) {
  return setting?.groups.flatMap((group) => group.options) ?? []
}

function isUltrafast(value: string) {
  return value.toLowerCase().replace(/[\s_-]/g, "") === "ultrafast"
}

interface Props {
  model: SessionSelectorSetting
  reasoning?: SessionSelectorSetting
  speed?: SessionSelectorSetting
  legacyFast?: boolean
  permission?: SessionSelectorSetting
  readOnly?: boolean
}

export function CodexComposerSettings({
  model,
  reasoning,
  speed,
  legacyFast,
  permission,
  readOnly,
}: Props) {
  const t = useTranslations("Folder.chat.messageInput")
  const { contentRef, onPointerDownOutside, onFocusOutside } =
    useScrollbarSafeDismiss()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const models = settingOptions(model)
  const search = query.trim().toLowerCase()
  const visible = search
    ? models.filter((item) =>
        [item.name, modelDisplayLabel(item.name), item.value].some((text) =>
          text.toLowerCase().includes(search)
        )
      )
    : models
  const modelShortLabel = modelDisplayLabel(model.currentLabel)
  const visibleSpeeds = settingOptions(speed).filter(
    (item) => !isUltrafast(item.value) && !isUltrafast(item.name)
  )
  const speedLabelFor = (value: string, label: string) =>
    legacyFast
      ? (speedOptions.find((option) => option.values.includes(value))?.name ??
        label)
      : label
  const speedLabel =
    speed &&
    !isUltrafast(speed.currentValue) &&
    !isUltrafast(speed.currentLabel)
      ? speedLabelFor(speed.currentValue, speed.currentLabel)
      : undefined
  const showSpeed = speed && visibleSpeeds.length > 0
  const showFastIcon = speedLabel?.toLowerCase() === "fast"
  const summary = [
    modelShortLabel,
    reasoning?.currentLabel,
    showFastIcon ? undefined : speedLabel,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery("")
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-codex-composer-summary=""
          data-selector-control=""
          className={cn(
            "inline-flex h-7 min-w-0 items-center gap-1 rounded-md bg-transparent px-1.5 text-xs hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring",
            composerControlTone
          )}
          title={summary}
          aria-label={showFastIcon ? `${summary} · ${speedLabel}` : summary}
        >
          <span className="truncate">{summary}</span>
          {showFastIcon && (
            <Zap aria-hidden strokeWidth={1.5} className="size-3 shrink-0" />
          )}
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        data-composer-selector-content=""
        onPointerDownOutside={onPointerDownOutside}
        onFocusOutside={onFocusOutside}
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        aria-label={t("agentSettings")}
        className="w-[min(30rem,calc(100vw-1rem))] max-w-(--radix-popover-content-available-width) max-h-(--radix-popover-content-available-height) gap-0 overflow-y-auto rounded-2xl border px-3 pt-3 pb-2 sm:px-4 sm:pt-4"
      >
        <div
          className={cn(
            "grid min-w-0 divide-border",
            reasoning && "grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] divide-x"
          )}
        >
          <section
            aria-label={t("modelListLabel")}
            className={cn("min-w-0", reasoning && "pe-2 sm:pe-4")}
          >
            <label
              className={cn(
                pickerColumnHeading,
                "group/search gap-2 text-muted-foreground"
              )}
            >
              <Search
                aria-hidden
                className="size-3.5 shrink-0 group-focus-within/search:text-foreground"
              />
              <input
                type="search"
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                aria-label={t("searchModelAria")}
                placeholder={t("searchModel")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || isImeCompositionKey(event))
                    return
                  event.preventDefault()
                  event.stopPropagation()
                  if (search && visible[0] && !readOnly)
                    model.onSelect(visible[0].value)
                }}
              />
            </label>
            <ScrollArea className="max-h-64" autoHide="scroll">
              <div className="space-y-1.5">
                {visible.map((item) => (
                  <SettingsRow
                    key={item.value}
                    label={modelDisplayLabel(item.name)}
                    hint={
                      item.value === model.recommendedValue
                        ? t("recommendedBadge")
                        : undefined
                    }
                    description={item.description}
                    selected={item.value === model.currentValue}
                    disabled={readOnly}
                    onSelect={() => model.onSelect(item.value)}
                  />
                ))}
                {visible.length === 0 && (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {t("noModels")}
                  </p>
                )}
              </div>
            </ScrollArea>
          </section>
          {reasoning && (
            <section
              aria-label={reasoning.title}
              className="min-w-0 ps-2 sm:ps-4"
            >
              <div className={cn(pickerColumnHeading, "justify-end")}>
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={model.currentLabel}
                >
                  {modelShortLabel}
                </span>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {settingOptions(reasoning).map((item) => (
                  <SettingsRow
                    key={item.value}
                    label={item.name}
                    description={item.description}
                    selected={item.value === reasoning.currentValue}
                    hint={
                      item.value === reasoning.recommendedValue
                        ? t("recommendedBadge")
                        : undefined
                    }
                    disabled={readOnly}
                    onSelect={() => reasoning.onSelect(item.value)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
        {(showSpeed || permission) && (
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            {showSpeed && (
              <div
                role="group"
                aria-label={speed.title}
                className="flex flex-wrap items-center gap-0.5"
              >
                {visibleSpeeds.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={item.value === speed.currentValue}
                    disabled={readOnly}
                    title={item.description ?? undefined}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground disabled:opacity-45 sm:px-3"
                    onClick={() => speed.onSelect(item.value)}
                  >
                    {speedLabelFor(item.value, item.name).toLowerCase() ===
                      "fast" && (
                      <Zap
                        aria-hidden
                        strokeWidth={1.5}
                        className="size-3 shrink-0"
                      />
                    )}
                    {speedLabelFor(item.value, item.name)}
                  </button>
                ))}
              </div>
            )}
            {permission && (
              <PermissionPicker
                setting={permission}
                readOnly={readOnly}
                className="ms-auto max-w-full"
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function PermissionPicker({
  setting,
  readOnly,
  className,
}: {
  setting: SessionSelectorSetting
  readOnly?: boolean
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const options = settingOptions(setting)
  const trigger = (
    <button
      type="button"
      aria-label={`${setting.title}: ${setting.currentLabel}`}
      title={setting.currentLabel}
      data-selector-control=""
      disabled={readOnly}
      className="inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-lg bg-transparent px-2 text-xs hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
    >
      <span className="truncate">{setting.currentLabel}</span>
      {isFullAccessPermission(setting.currentValue) && (
        <ShieldAlert aria-hidden className="size-3 shrink-0" />
      )}
      <ChevronDown
        aria-hidden
        className={cn("size-3 shrink-0", expanded && "rotate-180")}
      />
    </button>
  )
  return (
    <div className={cn("min-w-0", className)}>
      <Popover open={expanded} onOpenChange={setExpanded}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          aria-label={setting.title}
          side="top"
          align="end"
          sideOffset={5}
          collisionPadding={8}
          className="w-[21rem] max-w-(--radix-popover-content-available-width) max-h-(--radix-popover-content-available-height) gap-1.5 overflow-y-auto overscroll-contain rounded-xl border p-1.5"
        >
          {options.map((item) => {
            const selected = item.value === setting.currentValue
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={selected}
                disabled={readOnly}
                className="flex min-h-12 w-full shrink-0 items-center gap-2 rounded-md px-2.5 py-2.5 text-start hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent"
                onClick={() => {
                  setting.onSelect(item.value)
                  setExpanded(false)
                }}
              >
                <span className="min-w-0 truncate font-medium">
                  {item.name}
                </span>
                {isFullAccessPermission(item.value) && (
                  <ShieldAlert
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                )}
                {selected && (
                  <Check aria-hidden className="ms-auto size-3.5 shrink-0" />
                )}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function SettingsRow({
  label,
  description,
  selected,
  hint,
  disabled,
  onSelect,
}: {
  label: string
  description?: string | null
  selected: boolean
  hint?: string
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={description || label}
      className="flex min-h-8 w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-start text-sm hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:font-medium disabled:cursor-default"
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
      {selected && <Check aria-hidden className="size-3.5 shrink-0" />}
    </button>
  )
}
