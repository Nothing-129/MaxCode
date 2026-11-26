"use client"

import { useConversationMenuRequest } from "./conversation-menu-request"
import { useEffectEvent } from "react"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ClipboardPlus, Copy, Link2Off, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import { requestCreateTodo } from "@/lib/todo-compose-events"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import {
  TodoConversationLinkDialog,
  type TodoConversationLinkTarget,
} from "@/components/todos/todo-conversation-link-dialog"
import {
  createConversationShare,
  getWebServiceConfig,
  getConversationSharePreview,
  revokeConversationShare,
  updateWebServiceConfig,
  type WebServiceConfig,
  type ConversationShareRoundPreview,
} from "@/lib/api"
import {
  buildConversationShareUrl,
  normalizeConversationPublicShareUrl,
  resolveConversationShareAddress,
  type ConversationShareAddressSource,
} from "@/lib/conversation-share"
import { splitShareUserText } from "@/lib/conversation-share-content"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import type { ConversationShareOptions } from "@/lib/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { copyTextToClipboard } from "@/lib/utils"
import { getServerBaseUrl } from "@/lib/transport"
import { ConversationShareOptionsEditor } from "./conversation-share-options"

export function useConversationActionDialogs(
  conversationId: number | null,
  displayTitle: string
) {
  const t = useTranslations("Folder.conversationCard")
  const tTodos = useTranslations("Todos")
  const todosView = useOptionalTodosView()
  const setRoute = useOptionalWorkbenchRoute()?.setRoute
  const [linkTarget, setLinkTarget] =
    useState<TodoConversationLinkTarget | null>(null)
  const [shareTarget, setShareTarget] = useState<{
    id: number
    title: string
  } | null>(null)
  const [unavailableFiles, setUnavailableFiles] = useState<string[]>([])
  const [shareUrl, setShareUrl] = useState("")
  const [shareError, setShareError] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareAddressSource, setShareAddressSource] =
    useState<ConversationShareAddressSource | null>(null)
  const [shareNeedsPublicUrl, setShareNeedsPublicUrl] = useState(false)
  const [sharePublicUrlInput, setSharePublicUrlInput] = useState("")
  const [sharePublicUrlInvalid, setSharePublicUrlInvalid] = useState(false)
  const [shareConfig, setShareConfig] = useState<WebServiceConfig | null>(null)
  const [shareRounds, setShareRounds] = useState<
    ConversationShareRoundPreview[]
  >([])
  const [shareOptions, setShareOptions] = useState<ConversationShareOptions>({})
  const [shareExists, setShareExists] = useState(false)
  const shareRequest = useRef(0)
  const canCreateShare =
    !shareLoading &&
    shareConfig != null &&
    shareRounds.length > 0 &&
    shareOptions.rounds?.length !== 0
  const canCreateTodo =
    !shareLoading && shareRounds.length > 0 && shareOptions.rounds?.length !== 0

  const createShareLink = useCallback(
    async (
      target: { id: number; title: string },
      publicShareUrl: string | null
    ) => {
      const request = shareRequest.current
      setShareNeedsPublicUrl(false)
      setShareError(false)
      setShareLoading(true)
      try {
        const share = await createConversationShare(target.id, shareOptions)
        if (request !== shareRequest.current) return
        if (share.version !== 2)
          throw new Error("Share content selection is unavailable")
        setShareExists(true)
        const runtimeUrl = getServerBaseUrl()
        const resolved = resolveConversationShareAddress({
          publicShareUrl,
          runtimeUrl,
        })
        if (!resolved) throw new Error("Share server address is unavailable")
        setShareAddressSource(resolved.source)
        setUnavailableFiles(share.unavailable_files ?? [])
        setShareUrl(buildConversationShareUrl(resolved.baseUrl, share.token))
      } catch (err) {
        if (request !== shareRequest.current) return
        console.error("[ConversationDetailHeader] create share:", err)
        setShareError(true)
      } finally {
        if (request === shareRequest.current) setShareLoading(false)
      }
    },
    [shareOptions]
  )

  const handleShareOpen = useCallback(() => {
    if (conversationId == null) return
    const request = ++shareRequest.current
    const target = { id: conversationId, title: displayTitle }
    setShareTarget(target)
    setShareUrl("")
    setShareError(false)
    setShareCopied(false)
    setShareAddressSource(null)
    setShareNeedsPublicUrl(false)
    setSharePublicUrlInput("")
    setSharePublicUrlInvalid(false)
    setShareConfig(null)
    setShareOptions({})
    setShareRounds([])
    setShareExists(false)
    setShareLoading(true)
    void (async () => {
      try {
        const [config, preview] = await Promise.all([
          getWebServiceConfig(),
          getConversationSharePreview(target.id),
        ])
        if (request !== shareRequest.current) return
        if (preview.version !== 2)
          throw new Error("Share content selection is unavailable")
        setShareConfig(config)
        setShareRounds(
          preview.rounds.map((round) => ({
            ...round,
            preview: splitShareUserText(round.preview)
              .text.replace(/\s+/g, " ")
              .slice(0, 120),
          }))
        )
        setShareExists(preview.active_share)
        const runtimeUrl = getServerBaseUrl()
        const resolved = resolveConversationShareAddress({
          publicShareUrl: config.publicShareUrl,
          runtimeUrl,
        })
        if (
          resolved?.source === "configured_public" ||
          resolved?.source === "runtime_public"
        ) {
          return
        }
        setShareNeedsPublicUrl(true)
      } catch (err) {
        if (request !== shareRequest.current) return
        console.error("[ConversationDetailHeader] prepare share:", err)
        setShareError(true)
      } finally {
        if (request === shareRequest.current) setShareLoading(false)
      }
    })()
  }, [conversationId, displayTitle])

  const handleSavePublicUrlAndShare = useCallback(async () => {
    if (shareTarget == null || shareConfig == null || !canCreateShare) return
    const request = shareRequest.current
    const publicShareUrl =
      normalizeConversationPublicShareUrl(sharePublicUrlInput)
    if (!publicShareUrl) {
      setSharePublicUrlInvalid(true)
      return
    }
    setShareLoading(true)
    setShareError(false)
    try {
      const savedConfig = await updateWebServiceConfig({
        ...shareConfig,
        publicShareUrl,
      })
      if (request !== shareRequest.current) return
      setShareConfig(savedConfig)
      await createShareLink(
        shareTarget,
        savedConfig.publicShareUrl ?? publicShareUrl
      )
    } catch (err) {
      if (request !== shareRequest.current) return
      console.error("[ConversationDetailHeader] save public share URL:", err)
      setShareError(true)
    } finally {
      if (request === shareRequest.current) setShareLoading(false)
    }
  }, [
    canCreateShare,
    createShareLink,
    shareConfig,
    sharePublicUrlInput,
    shareTarget,
  ])

  const handleUseLocalShareAddress = useCallback(() => {
    if (shareTarget == null || !canCreateShare) return
    void createShareLink(shareTarget, null)
  }, [canCreateShare, createShareLink, shareTarget])

  const handleCopyShare = useCallback(async () => {
    if (!shareUrl) return
    const copied = await copyTextToClipboard(shareUrl)
    setShareCopied(copied)
  }, [shareUrl])

  const handleCloseShare = useCallback(() => {
    shareRequest.current += 1
    setShareTarget(null)
    setShareLoading(false)
  }, [])

  async function openTodoDraft(
    target: { id: number; title: string },
    options: ConversationShareOptions,
    existingLink = "",
    config: WebServiceConfig | null = null
  ) {
    const request = ++shareRequest.current
    const isCodex =
      useAppWorkspaceStore
        .getState()
        .conversations.find((c) => c.id === target.id)?.agent_type === "codex"
    const progress = shareTarget ? undefined : toast.loading(t("shareCreating"))
    setShareLoading(true)
    setShareError(false)
    try {
      let link = existingLink
      if (!link) {
        const addressConfig = config ?? (await getWebServiceConfig())
        if (request !== shareRequest.current) return
        const address = resolveConversationShareAddress({
          publicShareUrl: addressConfig.publicShareUrl,
          runtimeUrl: getServerBaseUrl(),
        })
        if (!address) throw new Error("Share server address is unavailable")
        const share = await createConversationShare(target.id, options)
        if (request !== shareRequest.current) return
        if (share.version !== 2)
          throw new Error("Share content selection is unavailable")
        link = buildConversationShareUrl(address.baseUrl, share.token)
        if (share.unavailable_files?.length) {
          toast.warning(t("shareFileUnavailable"), {
            description: share.unavailable_files.join(", "),
          })
        }
      }
      requestCreateTodo({
        title: target.title,
        text: [
          target.title,
          tTodos("conversationLinkContent", { url: link }),
        ].join("\n\n"),
        sourceUrl: link,
        conversationId: target.id,
        shareOptions: options,
        ...(isCodex && !options.rounds ? { canIncludeCodexSession: true } : {}),
      })
      handleCloseShare()
    } catch (err) {
      if (request !== shareRequest.current) return
      console.error("[ConversationDetailHeader] prepare todo share:", err)
      if (shareTarget) setShareError(true)
      else toast.error(t("shareFailed"))
    } finally {
      if (progress !== undefined) toast.dismiss(progress)
      if (request === shareRequest.current) setShareLoading(false)
    }
  }

  function handleTodoShareOpen() {
    if (conversationId == null || shareLoading) return
    void openTodoDraft({ id: conversationId, title: displayTitle }, {})
  }

  function handleShareAndCreateTodo() {
    if (shareTarget && canCreateTodo) {
      void openTodoDraft(shareTarget, shareOptions, shareUrl, shareConfig)
    }
  }

  const handleRevokeShare = useCallback(async () => {
    if (shareTarget == null) return
    const request = shareRequest.current
    setShareLoading(true)
    setShareError(false)
    try {
      await revokeConversationShare(shareTarget.id)
      if (request !== shareRequest.current) return
      handleCloseShare()
      setShareUrl("")
    } catch (err) {
      if (request !== shareRequest.current) return
      console.error("[ConversationDetailHeader] revoke share:", err)
      setShareError(true)
    } finally {
      if (request === shareRequest.current) setShareLoading(false)
    }
  }, [handleCloseShare, shareTarget])

  function linkTodo() {
    const state = todosView?.state
    if (conversationId == null || !state) return
    setLinkTarget({
      conversationId,
      title: displayTitle,
      scopeId:
        state.mode === "personal" ? "personal" : (state.active_team_id ?? ""),
      scopeName:
        state.mode === "personal"
          ? tTodos("personalMode")
          : (state.teams.find((team) => team.id === state.active_team_id)
              ?.name ?? tTodos("teamMode")),
    })
  }
  const dialogs = (
    <>
      {linkTarget && (
        <TodoConversationLinkDialog
          key={`${linkTarget.conversationId}:${linkTarget.scopeId}`}
          target={linkTarget}
          onClose={() => setLinkTarget(null)}
        />
      )}

      <Dialog
        open={shareTarget != null}
        onOpenChange={(open) => {
          if (!open) handleCloseShare()
        }}
      >
        <DialogContent className="min-w-0 grid-cols-1 overflow-x-hidden [&>*]:min-w-0 [&_[data-slot=dialog-footer]]:flex-wrap [&_[data-slot=dialog-footer]>button]:h-auto [&_[data-slot=dialog-footer]>button]:min-h-9 [&_[data-slot=dialog-footer]>button]:min-w-0 [&_[data-slot=dialog-footer]>button]:whitespace-normal">
          <DialogHeader>
            <DialogTitle>{t("shareDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("shareDialogDescription", { title: shareTarget?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {shareLoading && !shareUrl && !shareNeedsPublicUrl ? (
            <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {shareConfig ? t("shareCreating") : t("sharePreparing")}
            </div>
          ) : null}
          {shareConfig && !shareUrl ? (
            <ConversationShareOptionsEditor
              disabled={shareLoading}
              rounds={shareRounds}
              options={shareOptions}
              onChange={setShareOptions}
            />
          ) : null}
          {shareNeedsPublicUrl && !shareUrl ? (
            <div className="space-y-2">
              <label
                htmlFor="conversation-share-public-url"
                className="text-sm font-medium"
              >
                {t("sharePublicUrlLabel")}
              </label>
              <Input
                id="conversation-share-public-url"
                value={sharePublicUrlInput}
                onChange={(event) => {
                  setSharePublicUrlInput(event.target.value)
                  setSharePublicUrlInvalid(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSavePublicUrlAndShare()
                  }
                }}
                placeholder={t("sharePublicUrlPlaceholder")}
                aria-invalid={sharePublicUrlInvalid}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {t("sharePublicUrlHint")}
              </p>
              {sharePublicUrlInvalid ? (
                <p className="text-xs text-destructive">
                  {t("sharePublicUrlInvalid")}
                </p>
              ) : null}
            </div>
          ) : null}
          {shareUrl ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly aria-label={t("shareLink")} />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={handleCopyShare}
                  aria-label={t("shareCopy")}
                >
                  {shareCopied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("shareSnapshotHint")}
              </p>
              {unavailableFiles.length > 0 && (
                <p
                  role="status"
                  className="max-h-20 overflow-y-auto text-xs text-muted-foreground wrap-anywhere"
                >
                  {t("shareFileUnavailable")} · {unavailableFiles.join(", ")}
                </p>
              )}
              {shareAddressSource === "lan" ||
              shareAddressSource === "loopback" ||
              shareAddressSource === "runtime_private" ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("sharePrivateAddressHint")}
                </p>
              ) : null}
            </div>
          ) : null}
          {shareError ? (
            <p className="text-sm text-destructive">{t("shareFailed")}</p>
          ) : null}
          {shareExists && !shareUrl ? (
            <Button
              variant="outline"
              disabled={shareLoading}
              onClick={handleRevokeShare}
            >
              <Link2Off className="size-4" />
              {t("shareRevoke")}
            </Button>
          ) : null}
          {shareNeedsPublicUrl && !shareUrl ? (
            <DialogFooter className="sm:flex-wrap">
              {setRoute && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canCreateTodo}
                  onClick={handleShareAndCreateTodo}
                >
                  <ClipboardPlus className="size-4" />
                  {tTodos("shareAndCreate")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={!canCreateShare}
                onClick={handleUseLocalShareAddress}
              >
                {t("shareUseLocalAddress")}
              </Button>
              <Button
                type="button"
                disabled={!canCreateShare}
                onClick={() => void handleSavePublicUrlAndShare()}
              >
                {shareLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t("shareSavePublicUrl")}
              </Button>
            </DialogFooter>
          ) : !shareUrl ? (
            <DialogFooter className="sm:flex-wrap">
              <Button variant="outline" onClick={handleCloseShare}>
                {t("cancel")}
              </Button>
              {setRoute && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canCreateTodo}
                  onClick={handleShareAndCreateTodo}
                >
                  <ClipboardPlus className="size-4" />
                  {tTodos("shareAndCreate")}
                </Button>
              )}
              <Button
                disabled={!canCreateShare}
                onClick={() => {
                  if (shareTarget && canCreateShare)
                    void createShareLink(
                      shareTarget,
                      shareConfig?.publicShareUrl ?? null
                    )
                }}
              >
                {t("shareCreateLink")}
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter className="sm:flex-wrap">
              {setRoute && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canCreateTodo}
                  onClick={handleShareAndCreateTodo}
                >
                  <ClipboardPlus className="size-4" />
                  {tTodos("shareAndCreate")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={shareLoading || !shareUrl}
                onClick={handleRevokeShare}
              >
                <Link2Off className="size-4" />
                {t("shareRevoke")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={shareLoading}
                onClick={() => {
                  setShareUrl("")
                  setShareCopied(false)
                  setShareError(false)
                }}
              >
                {t("shareEditContent")}
              </Button>
              <Button type="button" onClick={handleCloseShare}>
                {t("shareDone")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
  return {
    handleShareOpen,
    handleTodoShareOpen,
    linkTodo,
    shareLoading,
    dialogs,
  }
}

export function ConversationMenuDialogs() {
  const pending = useConversationMenuRequest((s) => s.pending)
  const { handleShareOpen, handleTodoShareOpen, linkTodo, dialogs } =
    useConversationActionDialogs(pending?.id ?? null, pending?.title ?? "")
  const run = useEffectEvent((action: "share" | "todo" | "link") => {
    if (action === "share") handleShareOpen()
    else if (action === "todo") handleTodoShareOpen()
    else linkTodo()
  })
  useEffect(() => {
    if (
      !pending ||
      pending.action === "find" ||
      useConversationMenuRequest.getState().pending !== pending
    )
      return
    useConversationMenuRequest.setState({ pending: null })
    run(pending.action)
  }, [pending])
  return dialogs
}
