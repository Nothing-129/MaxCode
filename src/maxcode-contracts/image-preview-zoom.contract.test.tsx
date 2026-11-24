import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"

import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"
import messages from "@/i18n/messages/en.json"

afterEach(cleanup)

function preview(
  src = "/wide.png",
  open = true,
  onOpenChange: (open: boolean) => void = () => {}
) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ImagePreviewDialog
        src={src}
        alt="Wide screenshot"
        open={open}
        onOpenChange={onOpenChange}
      />
    </NextIntlClientProvider>
  )
}

function image() {
  return screen.getByRole("img", { name: "Wide screenshot" })
}

function touch(
  target: Element,
  event: "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  clientX = 0,
  clientY = 0
) {
  // jsdom does not provide a PointerEvent constructor.
  fireEvent(
    target,
    Object.assign(new MouseEvent(event, { bubbles: true, clientX, clientY }), {
      pointerId,
      pointerType: "touch",
    })
  )
}

describe("MaxCode image preview zoom", () => {
  it("zooms on wheel input and consumes the browser's default action", () => {
    render(preview())
    expect(fireEvent.wheel(image(), { deltaY: -300, ctrlKey: true })).toBe(
      false
    )
    expect(
      screen.getByRole("button", { name: "Fit image to screen" })
    ).toHaveTextContent("182%")
    fireEvent.wheel(image(), { deltaY: 350 })
    expect(image().style.transform).toContain("scale(1)")
  })

  it("zooms with buttons, returns to fit and starts fresh for another image", () => {
    const { rerender } = render(preview())
    const zoomIn = screen.getByRole("button", { name: "Zoom in" })
    fireEvent.click(zoomIn)
    expect(image().style.transform).toContain("scale(1.5)")
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    expect(image().style.transform).toContain("scale(1)")
    fireEvent.click(zoomIn)
    fireEvent.click(screen.getByRole("button", { name: "Fit image to screen" }))
    expect(image().style.transform).toContain("scale(1)")
    fireEvent.click(zoomIn)
    rerender(preview("/another.png"))
    expect(image().style.transform).toContain("scale(1)")
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    rerender(preview("/another.png", false))
    rerender(preview("/another.png"))
    expect(image().style.transform).toContain("scale(1)")
  })

  it("pinches across a narrow image and pans with the remaining finger", () => {
    const closes: boolean[] = []
    render(preview("/wide.png", true, (open) => closes.push(open)))
    const photo = image()
    const viewport = photo.parentElement!
    Object.defineProperties(photo, {
      offsetWidth: { value: 360 },
      offsetHeight: { value: 45 },
    })
    Object.defineProperties(viewport, {
      clientWidth: { value: 400 },
      clientHeight: { value: 700 },
    })

    touch(photo, "pointerdown", 1, 150, 350)
    touch(viewport, "pointerdown", 2, 250, 400)
    touch(viewport, "pointermove", 2, 350, 450)
    expect(photo.style.transform).toContain("scale(2)")
    touch(viewport, "pointerup", 2)
    touch(viewport, "pointermove", 1, 190, 350)
    expect(photo.style.transform).toBe("translate(90px, 0px) scale(2)")
    touch(viewport, "pointerup", 1)
    fireEvent.click(viewport)
    expect(closes).toEqual([])

    touch(viewport, "pointerdown", 3)
    touch(viewport, "pointerup", 3)
    fireEvent.click(viewport)
    expect(closes).toEqual([false])
  })
})
