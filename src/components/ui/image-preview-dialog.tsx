"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Copy, Download, Minus, Plus, RotateCw, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface ImagePreviewDialogProps {
  src: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * When provided, render a download icon button next to the close button.
   * The handler is invoked on click; the dialog stays open so the caller
   * can show its own progress/toast feedback.
   */
  onDownload?: () => void
  downloadLabel?: string
  onCopy?: () => void
  copyLabel?: string
  /**
   * Wrap the image element — used to hang a right-click menu off it, so the
   * blown-up picture offers the same actions as its thumbnail did. A render
   * prop keeps this ui/ component free of message-specific imports.
   */
  renderImage?: (image: ReactNode) => ReactNode
}

function ImagePreviewDialog({
  src,
  alt,
  open,
  onOpenChange,
  onDownload,
  downloadLabel,
  onCopy,
  copyLabel,
  renderImage,
}: ImagePreviewDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0",
            "fixed inset-0 z-50 bg-black/80 duration-100 supports-backdrop-filter:backdrop-blur-xs"
          )}
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          aria-describedby={undefined}
          onClick={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">
            {alt}
          </DialogPrimitive.Title>
          <div className="absolute z-10 flex items-center gap-2 right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))]">
            {onCopy && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy()
                }}
                className="rounded-full bg-background/60 p-1.5 text-foreground/80 hover:bg-background/80 hover:text-foreground"
                aria-label={copyLabel ?? "Copy image"}
                title={copyLabel ?? "Copy image"}
              >
                <Copy className="h-5 w-5" />
              </button>
            )}
            {onDownload && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDownload()
                }}
                className="rounded-full bg-background/60 p-1.5 text-foreground/80 hover:bg-background/80 hover:text-foreground"
                aria-label={downloadLabel ?? "Download"}
                title={downloadLabel ?? "Download"}
              >
                <Download className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full bg-background/60 p-1.5 text-foreground/80 hover:bg-background/80 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {open && src && (
            <ImagePreviewViewport
              key={src}
              src={src}
              alt={alt}
              renderImage={renderImage}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

type Point = { x: number; y: number }
type View = Point & { scale: number; rotation: number }

const fitView = { x: 0, y: 0, scale: 1 }
const initialView: View = { ...fitView, rotation: 0 }
const maxScale = 6

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function gesturePoint(points: Map<number, Point>) {
  const [first, second = first] = points.values()
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.hypot(first.x - second.x, first.y - second.y),
  }
}

function ImagePreviewViewport({
  src,
  alt,
  renderImage,
}: Pick<ImagePreviewDialogProps, "src" | "alt" | "renderImage">) {
  const t = useTranslations("ImagePreview")
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const consumedGesture = useRef(false)
  const currentView = useRef(initialView)
  const [view, setView] = useState(initialView)

  const updateView = useCallback((next: View) => {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !image) return
    const sideways = next.rotation % 180 !== 0
    const width = sideways ? image.offsetHeight : image.offsetWidth
    const height = sideways ? image.offsetWidth : image.offsetHeight
    const maxX = Math.max(0, (width * next.scale - viewport.clientWidth) / 2)
    const maxY = Math.max(0, (height * next.scale - viewport.clientHeight) / 2)
    const updated =
      next.scale === 1
        ? { ...next, ...fitView }
        : {
            ...next,
            x: clamp(next.x, -maxX, maxX),
            y: clamp(next.y, -maxY, maxY),
          }
    const previous = currentView.current
    if (
      updated.rotation === previous.rotation &&
      updated.scale === previous.scale &&
      updated.x === previous.x &&
      updated.y === previous.y
    )
      return
    currentView.current = updated
    setView(updated)
  }, [])

  const zoomBy = useCallback(
    (factor: number, from?: Point, to = from) => {
      const viewport = viewportRef.current
      if (!viewport) return
      const previous = currentView.current
      const scale = clamp(previous.scale * factor, 1, maxScale)
      const ratio = scale / previous.scale
      const bounds = viewport.getBoundingClientRect()
      const anchorX = from ? from.x - bounds.left - viewport.clientWidth / 2 : 0
      const anchorY = from ? from.y - bounds.top - viewport.clientHeight / 2 : 0
      updateView({
        ...previous,
        scale,
        x:
          anchorX +
          (previous.x - anchorX) * ratio +
          (to && from ? to.x - from.x : 0),
        y:
          anchorY +
          (previous.y - anchorY) * ratio +
          (to && from ? to.y - from.y : 0),
      })
    },
    [updateView]
  )

  useEffect(() => {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !image) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1)
      zoomBy(Math.exp(-delta * 0.002), { x: event.clientX, y: event.clientY })
    }
    viewport.addEventListener("wheel", onWheel, { passive: false })
    const observer = new ResizeObserver(() => updateView(currentView.current))
    observer.observe(viewport)
    observer.observe(image)
    return () => {
      viewport.removeEventListener("wheel", onWheel)
      observer.disconnect()
    }
  }, [updateView, zoomBy])

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return
    if (pointers.current.size === 0) consumedGesture.current = false
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    if (pointers.current.size === 2) consumedGesture.current = true
    if (event.target instanceof Element) {
      // Keep click targeting intact for a regular tap on the image or backdrop.
      event.target.setPointerCapture(event.pointerId)
    }
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    const from = gesturePoint(pointers.current)
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    const to = gesturePoint(pointers.current)
    if (pointers.current.size === 1 && currentView.current.scale === 1) return
    if (from.x === to.x && from.y === to.y && from.distance === to.distance)
      return
    consumedGesture.current = true
    zoomBy(from.distance ? to.distance / from.distance : 1, from, to)
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
  }

  const image = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      draggable={false}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "shrink-0 rounded-lg object-contain select-none",
        view.rotation % 180 !== 0
          ? "max-h-[90vw] max-w-[90vh]"
          : "max-h-[90vh] max-w-[90vw]",
        view.scale > 1 && "cursor-grab active:cursor-grabbing"
      )}
      style={{
        translate: `${view.x}px ${view.y}px`,
        rotate: `${view.rotation}deg`,
        scale: view.scale,
      }}
    />
  )
  const controlClass =
    "grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-background/70 aria-disabled:opacity-40"

  return (
    <>
      <div
        ref={viewportRef}
        className="absolute inset-0 flex touch-none items-center justify-center overflow-hidden"
        onPointerDown={startPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={endPointer}
        onClick={(event) => {
          if (consumedGesture.current) event.stopPropagation()
        }}
      >
        {renderImage ? renderImage(image) : image}
      </div>
      <div
        className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-background/90 px-1 text-foreground shadow-md"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={t("zoomOut")}
          title={t("zoomOut")}
          aria-disabled={view.scale === 1}
          className={controlClass}
          onClick={() => zoomBy(1 / 1.5)}
        >
          <Minus className="size-5" />
        </button>
        <button
          type="button"
          aria-label={t("fit")}
          title={t("fit")}
          className={cn(controlClass, "px-2 text-sm tabular-nums")}
          onClick={() => updateView({ ...currentView.current, ...fitView })}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          type="button"
          aria-label={t("zoomIn")}
          title={t("zoomIn")}
          aria-disabled={view.scale === maxScale}
          className={controlClass}
          onClick={() => zoomBy(1.5)}
        >
          <Plus className="size-5" />
        </button>
        <button
          type="button"
          aria-label={t("rotateClockwise")}
          title={t("rotateClockwise")}
          className={controlClass}
          onClick={() =>
            updateView({
              ...fitView,
              rotation: (currentView.current.rotation + 90) % 360,
            })
          }
        >
          <RotateCw aria-hidden="true" className="size-5" />
        </button>
      </div>
    </>
  )
}

export { ImagePreviewDialog }
