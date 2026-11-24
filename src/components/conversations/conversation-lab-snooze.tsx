"use client"
import {
  Clock1,
  Clock3,
  Moon,
  Sunrise,
  CalendarDays,
  CalendarClock,
} from "lucide-react"
import { useState } from "react"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { snoozePresets } from "@/lib/conversation-lab"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"

const presetIcons = {
  oneHour: Clock1,
  threeHours: Clock3,
  tonight: Moon,
  tomorrow: Sunrise,
  nextWeek: CalendarDays,
}

export function SnoozeChoices({
  snooze,
  custom,
  context = false,
}: {
  snooze: (at: number) => void
  custom: () => void
  context?: boolean
}) {
  const l = useTranslations("Folder.sidebar.lab")
  const format = useFormatter()
  const now = useNow({ updateInterval: 30000 }).getTime()
  const Item = context ? ContextMenuItem : DropdownMenuItem
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator
  return (
    <>
      {snoozePresets(now).map(({ key, at }) => {
        const Icon = presetIcons[key]
        return (
          <Item
            key={key}
            onSelect={() => {
              const future =
                key === "oneHour" || key === "threeHours"
                  ? Date.now() + 3600000 * (key === "oneHour" ? 1 : 3)
                  : at
              if (future > Date.now()) snooze(future)
            }}
          >
            <Icon />
            {l(key)}
            <span className="ms-auto ps-3 text-xs text-muted-foreground">
              {format.dateTime(at, {
                hour: "numeric",
                minute: "2-digit",
                ...(key === "nextWeek" ? { weekday: "short" } : {}),
              })}
            </span>
          </Item>
        )
      })}
      <Separator />
      <Item onSelect={custom}>
        <CalendarClock />
        {l("custom")}
      </Item>
    </>
  )
}

export function CustomSnooze({
  snooze,
  close,
}: {
  snooze: (at: number) => void
  close: () => void
}) {
  const l = useTranslations("Folder.sidebar.lab")
  const [mode, setMode] = useState("duration")
  const [unit, setUnit] = useState("hours")
  const [amount, setAmount] = useState("1")
  const [date, setDate] = useState(() => {
    const d = new Date(Date.now() + 3600000)
    return new Date(+d - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
  })
  const now = useNow({ updateInterval: 15000 }).getTime()
  const when = (base: number) =>
    mode === "date"
      ? new Date(date).getTime()
      : base +
        Number(amount) *
          (unit === "hours" ? 3600000 : unit === "days" ? 86400000 : 60000)
  const valid = (base: number) =>
    Number.isFinite(new Date(when(base)).getTime()) && when(base) > base
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) close()
      }}
    >
      <DialogContent>
        <DialogTitle>{l("snooze")}</DialogTitle>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const base = Date.now()
            if (valid(base)) {
              snooze(when(base))
              close()
            }
          }}
        >
          <div className="flex gap-2">
            {(["duration", "date"] as const).map((x) => (
              <Button
                type="button"
                key={x}
                variant={mode === x ? "secondary" : "ghost"}
                aria-pressed={mode === x}
                onClick={() => setMode(x)}
              >
                {l(x)}
              </Button>
            ))}
          </div>
          {mode === "duration" ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label={l("duration")}
              />
              <select
                className="rounded border bg-background px-2"
                value={unit}
                aria-label={l("duration")}
                onChange={(e) => setUnit(e.target.value)}
              >
                {(["minutes", "hours", "days"] as const).map((x) => (
                  <option key={x} value={x}>
                    {l(x)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <Input
              type="datetime-local"
              aria-label={l("date")}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
          <Button disabled={!valid(now)}>{l("snooze")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
