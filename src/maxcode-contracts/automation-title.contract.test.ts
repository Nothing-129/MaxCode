import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: automation conversation titles", () => {
  it("keeps automation runs named after the automation, and parser-proof", () => {
    const engine = source("src-tauri/src/automation/engine.rs")

    expect(engine).toContain("automation_conversation_title(&auto.name)")
    expect(engine).toContain("first_chars(name.trim(), 80)")
    expect(engine).toContain("conversation_service::lock_title")
  })
})
