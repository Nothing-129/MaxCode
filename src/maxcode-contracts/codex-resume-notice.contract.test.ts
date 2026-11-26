import { expect, it } from "vitest"
import { source } from "./contract-source"

it("applies the Codex resume advisory filter to idle and active notices", () => {
  const runtime = source("src-tauri/src/acp/connection.rs")
  const liveNoticeBranches = runtime.match(
    /else if let Some\(notice\) = session_notice\(&dispatch\) \{\s*if !should_surface_session_notice\(agent_type, &notice\) \{\s*continue;/g
  )
  expect(liveNoticeBranches).toHaveLength(2)
  expect(runtime).toContain("mod codex_resume_notice_contract;")
})
