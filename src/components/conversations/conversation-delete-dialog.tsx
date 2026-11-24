import { useTranslations } from "next-intl"
import { formatConversationTitle } from "@/lib/conversation-title"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function ConversationDeleteDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string | null
  onConfirm: () => void
}) {
  const t = useTranslations("Folder.conversationCard")
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteConversationDescription", {
              title:
                formatConversationTitle(title) || t("untitledConversation"),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
