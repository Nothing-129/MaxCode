import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: compact activity summary", () => {
  it("keeps the disclosure text and chevron without a trailing divider", () => {
    const renderer = source("src/components/message/content-parts-renderer.tsx")
    const summary = renderer.slice(
      renderer.indexOf("const CompletedActivitySummary ="),
      renderer.indexOf("interface ContentPartsRendererProps")
    )

    expect(summary).toContain("<CollapsibleTrigger")
    expect(summary).toContain("<ChevronRightIcon")
    expect(summary).not.toMatch(/h-px|<Separator|<hr\b|border-t\b/)
  })

  it("uses smaller text for revealed activity and tool titles", () => {
    const renderer = source("src/components/message/content-parts-renderer.tsx")
    const css = source("src/app/globals.css")
    const tool = source("src/components/ai-elements/tool.tsx")
    const group = renderer.slice(
      renderer.indexOf("const ToolGroupPart ="),
      renderer.indexOf("// ── Main renderer")
    )
    const summary = renderer.slice(
      renderer.indexOf("const CompletedActivitySummary ="),
      renderer.indexOf("interface ContentPartsRendererProps")
    )

    expect(group).toContain('className="maxcode-activity-details ')
    expect(summary).toContain('className="maxcode-activity-details ')
    expect(css).toMatch(
      /\.maxcode-activity-details\s*\{[^}]*--chat-font-size: 0\.75rem;/
    )
    expect(css).toMatch(
      /\.maxcode-activity-details \[data-slot="tool-title"\]\s*\{[^}]*font-size: inherit;/
    )
    expect(tool).toContain('data-slot="tool-title"')
  })
})
