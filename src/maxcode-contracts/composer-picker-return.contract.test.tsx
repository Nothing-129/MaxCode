import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import messages from "@/i18n/messages/en.json"
import { ComposerImageThumbnails } from "@/components/chat/composer/composer-image-thumbnails"
import { useComposerAttachments } from "@/components/chat/composer/use-composer-attachments"
import { blobToBase64 } from "@/components/chat/composer/attachment-files"
import { uploadAttachment } from "@/lib/api"

vi.mock("@/components/chat/composer/attachment-files", async (original) => ({
  ...(await original<
    typeof import("@/components/chat/composer/attachment-files")
  >()),
  blobToBase64: vi.fn(),
}))
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  uploadAttachment: vi.fn(),
}))

function Composer() {
  const attach = useComposerAttachments({
    editorRef: { current: null },
    promptCapabilities: { image: true, embedded_context: false },
  })
  return (
    <>
      <button onClick={attach.handleUploadLocalFiles}>Choose</button>
      <button disabled={attach.hasUploadingImage}>Send</button>
      <ComposerImageThumbnails
        attachments={attach.imageAttachments}
        onRemove={attach.removeAttachment}
      />
    </>
  )
}

function chooseFiles(...files: File[]) {
  let selection!: Promise<unknown>
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement
  ) {
    Object.defineProperty(this, "files", { value: files })
    selection = Promise.resolve(this.onchange!.call(this, new Event("change")))
  })
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Composer />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "Choose" }))
  return selection
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe("returning from the system file picker", () => {
  it("waits to read the image until the returning chat is visible", async () => {
    vi.useFakeTimers()
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    const image = new File(["bytes"], "hidden.jpg", { type: "image/jpeg" })
    vi.mocked(blobToBase64).mockResolvedValue("Ynl0ZXM=")
    vi.mocked(uploadAttachment).mockResolvedValue({
      path: "/uploads/hidden.jpg",
      name: image.name,
      size: image.size,
      mimeType: image.type,
    })
    try {
      const selection = chooseFiles(image)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1800)
      })
      expect(screen.getByText(image.name)).toBeInTheDocument()
      expect(blobToBase64).not.toHaveBeenCalled()
      hidden.mockReturnValue(false)
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
        await vi.advanceTimersByTimeAsync(500)
        await selection
      })
      expect(screen.getByRole("img", { name: image.name })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows a removable image before reading its bytes and keeps it removed when the read finishes", async () => {
    let finishRead!: (data: string) => void
    vi.mocked(blobToBase64).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve
        })
    )
    vi.mocked(uploadAttachment).mockResolvedValue({
      path: "/uploads/screen.jpg",
      name: "screen.jpg",
      size: 5,
      mimeType: "image/jpeg",
    })
    const file = new File(["bytes"], "screen.jpg", { type: "image/jpeg" })
    const selection = chooseFiles(file)
    expect(screen.getByText("screen.jpg")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
    expect(blobToBase64).not.toHaveBeenCalled()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    await waitFor(() => expect(blobToBase64).toHaveBeenCalledWith(file))
    fireEvent.click(screen.getByRole("button", { name: "Remove screen.jpg" }))
    await act(async () => {
      finishRead("Ynl0ZXM=")
      await selection
    })
    await waitFor(() =>
      expect(screen.queryByText("screen.jpg")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled()
  })

  it("keeps the readable image when another selected file cannot be read", async () => {
    const broken = new File(["broken"], "broken.jpg", { type: "image/jpeg" })
    const good = new File(["bytes"], "good.jpg", { type: "image/jpeg" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(blobToBase64).mockImplementation(async (file) => {
      if (file === broken) throw new Error("File unavailable")
      return "Ynl0ZXM="
    })
    vi.mocked(uploadAttachment).mockResolvedValue({
      path: "/uploads/good.jpg",
      name: good.name,
      size: good.size,
      mimeType: good.type,
    })
    const selection = chooseFiles(broken, good)
    expect(screen.getByText(broken.name)).toBeInTheDocument()
    expect(screen.getByText(good.name)).toBeInTheDocument()
    await act(async () => {
      await selection
    })
    await waitFor(() =>
      expect(screen.queryByText(broken.name)).not.toBeInTheDocument()
    )
    expect(screen.getByRole("img", { name: good.name })).toBeVisible()
    expect(uploadAttachment).toHaveBeenCalledExactlyOnceWith(good, null)
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled()
  })
})
