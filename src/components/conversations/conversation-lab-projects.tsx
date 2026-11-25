"use client"

import { useRef, useState } from "react"
import { ListFilter, SquarePen } from "lucide-react"
import { useTranslations } from "next-intl"
import { FolderMenuContent } from "@/components/shared/folder-select"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { LabProjectBadge } from "./lab-project-badge"
import { formatFolderLabelWithAlias } from "@/lib/folder-display"
import { isImeCompositionKey } from "@/lib/ime-composition"
import type { FolderDetail } from "@/lib/types"

export const labTool =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-interaction-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
export function LabProjectTools({
  projects,
  composeProjects,
  selected,
  setSelected,
  start,
}: {
  projects: FolderDetail[]
  composeProjects: FolderDetail[]
  selected: string[]
  setSelected: (ids: string[]) => void
  start: (folder?: FolderDetail) => void
}) {
  const l = useTranslations("Folder.sidebar.lab")
  const t = useTranslations("Folder.conversationContextBar")
  const chatLabel = useTranslations("Folder.sidebar")("sectionChats")
  const empty = useTranslations("Folder.search")("noResults")
  const [filter, setFilter] = useState(false)
  const shift = useRef(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const entries = projects.map((f) => ({
    id: String(f.id),
    name: formatFolderLabelWithAlias(f),
    color: f.color,
  }))
  const chatProject = { id: "none", name: chatLabel, color: undefined }
  const selectedProjects = selected.flatMap((id) => {
    const entry =
      id === "none" ? chatProject : entries.find((project) => project.id === id)
    return entry ? [entry] : []
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
                {selectedProjects
                  .slice(0, 2)
                  .map(({ id, name, color }, index) => (
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
                        folderColor={color}
                      />
                    </span>
                  ))}
              </span>
            ) : (
              <ListFilter className="size-4" />
            )}
          </button>
        </PopoverTrigger>
        <FolderMenuContent
          loop
          folders={projects.map((folder) => ({
            ...folder,
            icon: (
              <LabProjectBadge
                name={formatFolderLabelWithAlias(folder)}
                folderColor={folder.color}
              />
            ),
          }))}
          value={selected.filter((id) => id !== "none").map(Number)}
          labelSearch={l("searchProjects")}
          labelEmpty={empty}
          onSelect={(id) => choose(String(id))}
          actions={[
            {
              label: l("all"),
              selected: selected.length === 0,
              onSelect: () => choose("all"),
            },
            {
              label: chatLabel,
              chat: true,
              selected: selected.includes("none"),
              onSelect: () => choose("none"),
            },
          ]}
          onKeyDownCapture={(e) => {
            shift.current = e.shiftKey
            if (isImeCompositionKey(e)) e.stopPropagation()
          }}
          onClickCapture={(e) => {
            shift.current = e.shiftKey
          }}
        />
      </Popover>
      <Popover open={composeOpen} onOpenChange={setComposeOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={labTool}
            title={l("compose")}
            aria-label={l("compose")}
          >
            <SquarePen className="size-4" />
          </button>
        </PopoverTrigger>
        <FolderMenuContent
          folders={composeProjects}
          value={null}
          labelSearch={t("searchFolder")}
          labelEmpty={t("noFolders")}
          onSelect={(id) => {
            const folder = composeProjects.find((project) => project.id === id)
            if (folder) compose(folder)
          }}
          actions={[
            {
              label: t("chatModeLabel"),
              description: t("chatModeDescription"),
              chat: true,
              onSelect: () => compose(),
            },
          ]}
          onKeyDownCapture={(e) => {
            if (isImeCompositionKey(e)) {
              e.stopPropagation()
              return
            }
          }}
        />
      </Popover>
    </>
  )
}
