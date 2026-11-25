import { Folder, MessageSquare } from "lucide-react"

export function LabProjectBadge({
  name,
}: {
  name: string | null
  folderColor?: string
}) {
  const Icon = name === null ? MessageSquare : Folder
  return (
    <Icon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground"
      strokeWidth={1.75}
    />
  )
}
