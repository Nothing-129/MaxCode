import { createContext, useContext } from "react"
import type { ConversationLabState } from "./conversation-lab-state"

export const ConversationLabContext =
  createContext<ConversationLabState | null>(null)
export function useOptionalLabState() {
  return useContext(ConversationLabContext)
}
export function useLabState() {
  const value = useOptionalLabState()
  if (!value)
    throw new Error("ConversationLab requires ConversationLabProvider")
  return value
}
