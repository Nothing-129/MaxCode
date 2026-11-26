import { create } from "zustand"

type MenuRequest = {
  id: number
  title: string
  action: "find" | "share" | "todo" | "link"
}
export const useConversationMenuRequest = create<{
  pending: MenuRequest | null
}>(() => ({ pending: null }))

// A find request can precede the mounting of its message thread.
export function requestConversationMenuAction(request: MenuRequest) {
  useConversationMenuRequest.setState({ pending: request })
}
