/** Permission selectors are conversation-owned, regardless of adapter spelling. */
export function isPermissionConfigId(id: string): boolean {
  return [
    "mode",
    "permission",
    "permissions",
    "permission_mode",
    "approval",
    "approval_mode",
    "approval_policy",
    "sandbox",
    "sandbox_mode",
    "auto_approve",
  ].includes(id.replace(/-/g, "_").toLowerCase())
}

export function isPermissionConfigCategory(category?: string | null): boolean {
  return ["mode", "permission", "permissions", "approval", "sandbox"].includes(
    category ?? ""
  )
}

export function isFullAccessPermission(value?: string | null): boolean {
  return ["agent-full-access", "danger-full-access", "full-access"].includes(
    value?.replace(/_/g, "-").toLowerCase() ?? ""
  )
}
