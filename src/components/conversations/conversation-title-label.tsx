import type { ComponentPropsWithoutRef } from "react"

import { formatConversationTitle } from "@/lib/conversation-title"
import { cn } from "@/lib/utils"

export function ConversationTitleLabel({
  title,
  fallback,
  className,
  ...rest
}: {
  title: string | null | undefined
  fallback: string
} & Omit<ComponentPropsWithoutRef<"span">, "title">) {
  return (
    <span className={cn("truncate", className)} {...rest}>
      {formatConversationTitle(title) || fallback}
    </span>
  )
}
