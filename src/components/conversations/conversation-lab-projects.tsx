"use client"

import { useRef, useState } from "react"
import {
  Check,
  ListFilter,
  Folder,
  MessageCircle,
  SquarePen,
} from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
} from "@/components/ui/command"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { LabProjectBadge } from "./lab-project-badge"
import { formatFolderLabelWithAlias } from "@/lib/folder-display"
import { isImeCompositionKey } from "@/lib/ime-composition"
import type { FolderDetail } from "@/lib/types"

export const labTool =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-interaction-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
export function LabProjectTools({
  projects,
  selected,
  setSelected,
  start,
}: {
  projects: FolderDetail[]
  selected: string[]
  setSelected: (ids: string[]) => void
  start: (folder?: FolderDetail) => void
}) {
  const l = useTranslations("Folder.sidebar.lab")
  const chatLabel = useTranslations("Folder.sidebar")("sectionChats")
  const empty = useTranslations("Folder.search")("noResults")
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
  const [filter, setFilter] = useState(false)
  const [filterQuery, setFilterQuery] = useState("")
  const shift = useRef(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const entries = projects.map((f) => ({
    id: String(f.id),
    name: formatFolderLabelWithAlias(f),
    folder: f,
  }))
  const selectedProjects = selected.flatMap((id) => {
    if (id === "none") return [{ id, name: chatLabel }]
    const entry = entries.find((project) => project.id === id)
    return entry ? [{ id, name: entry.name }] : []
  })
  const filterLabel = [
    l("filter"),
    ...selectedProjects.map((p) => p.name),
  ].join(" · ")
  function choose(id: string) {
    if (id === "all") setSelected([])
    else if (shift.current)
      setSelected(
        selected.includes(id)
          ? selected.filter((i) => i !== id)
          : [...selected, id]
      )
    else setSelected([id])
    if (!shift.current || id === "all") setFilter(false)
    shift.current = false
  }
  function compose(f?: FolderDetail) {
    setComposeOpen(false)
    start(f)
  }
  return (
    <>
      <Popover
        open={filter}
        onOpenChange={(v) => {
          setFilter(v)
          setFilterQuery("")
          shift.current = false
        }}
      >
        <PopoverTrigger asChild>
          <button
            className={labTool}
            aria-label={filterLabel}
            title={filterLabel}
          >
            {selectedProjects.length ? (
              <span className="flex shrink-0">
                {selectedProjects.slice(0, 2).map(({ id, name }, index) => (
                  <span
                    key={id}
                    className={
                      index
                        ? "-ms-1 flex rounded-[25%] bg-sidebar ring-2 ring-sidebar"
                        : "flex"
                    }
                  >
                    <LabProjectBadge
                      name={id === "none" ? null : name}
                      small={selectedProjects.length > 1}
                    />
                  </span>
                ))}
              </span>
            ) : (
              <ListFilter className="size-4" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 p-0"
          onKeyDownCapture={(e) => {
            shift.current = e.shiftKey
            if (isImeCompositionKey(e)) e.stopPropagation()
          }}
          onClickCapture={(e) => {
            shift.current = e.shiftKey
          }}
        >
          <Command loop>
            <CommandInput
              value={filterQuery}
              onValueChange={setFilterQuery}
              placeholder={l("searchProjects")}
              aria-label={l("searchProjects")}
            />
            <CommandList>
              <CommandEmpty>{empty}</CommandEmpty>
              {[
                ...(!filterQuery.trim() ? [{ id: "all", name: l("all") }] : []),
                ...entries,
                { id: "none", name: chatLabel },
              ].map(({ id, name }) => (
                <CommandItem
                  key={id}
                  value={id + " " + name}
                  onSelect={() => choose(id)}
                >
                  <span className="relative flex shrink-0">
                    {id === "all" ? (
                      <Folder />
                    ) : (
                      <LabProjectBadge name={id === "none" ? null : name} />
                    )}
                    {(selected.includes(id) ||
                      (id === "all" && !selected.length)) && (
                      <span className="pointer-events-none absolute -end-1 -bottom-1 grid size-3 place-items-center rounded-full bg-primary ring-2 ring-popover">
                        <Check
                          aria-hidden="true"
                          className="size-2! text-primary-foreground"
                          strokeWidth={4}
                        />
                      </span>
                    )}
                  </span>
                  <span className="truncate">{name}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <button
        className={labTool}
        title={l("compose")}
        aria-label={l("compose")}
        onClick={() => setComposeOpen(true)}
      >
        <SquarePen className="size-4" />
      </button>
      {composeOpen && (
        <CommandDialog open onOpenChange={setComposeOpen} title={l("compose")}>
          <div
            onKeyDownCapture={(e) => {
              if (isImeCompositionKey(e)) {
                e.stopPropagation()
                return
              }
              if (!(e.metaKey || e.ctrlKey)) return
              const f = /^[1-9]$/.test(e.key)
                ? projects[Number(e.key) - 1]
                : undefined
              if (f || (e.altKey && e.code === "KeyN")) {
                e.preventDefault()
                compose(f)
              }
            }}
          >
            <CommandInput
              placeholder={l("search") + "…"}
              aria-label={l("search")}
            />
            <CommandList>
              <CommandEmpty>{empty}</CommandEmpty>
              <CommandGroup heading={l("projects")}>
                <CommandItem onSelect={() => compose()}>
                  <MessageCircle />
                  {chatLabel}
                  <kbd className="ms-auto text-xs text-muted-foreground">
                    {mac ? "⌥⌘N" : "Ctrl+Alt+N"}
                  </kbd>
                </CommandItem>
                {entries.map(({ id, name, folder }, index) => (
                  <CommandItem
                    key={id}
                    value={id + " " + name + " " + folder.path}
                    onSelect={() => compose(folder)}
                  >
                    <Folder />
                    <span className="truncate">{name}</span>
                    <small className="ms-auto truncate text-muted-foreground">
                      {l("local")} · {folder.path}
                    </small>
                    {index < 9 && (
                      <kbd className="text-xs text-muted-foreground">
                        {mac ? "⌘" : "Ctrl+"}
                        {index + 1}
                      </kbd>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </div>
        </CommandDialog>
      )}
    </>
  )
}
