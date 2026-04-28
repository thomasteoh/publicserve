// tests/lib/permissions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/identity/groups", () => ({
  getGroup: vi.fn(),
  getAdminGroups: vi.fn(),
}))
vi.mock("@/lib/identity/user-groups", () => ({
  getGroupsForUser: vi.fn(),
}))
vi.mock("@/lib/identity/org-groups", () => ({
  getOrgGroups: vi.fn(),
}))

import { getGroup, getAdminGroups } from "@/lib/identity/groups"
import { getGroupsForUser } from "@/lib/identity/user-groups"
import { getOrgGroups } from "@/lib/identity/org-groups"

describe("resolvePermissions", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns isAdmin=true when user is in admin group", async () => {
    vi.mocked(getGroupsForUser).mockResolvedValue(["g-admin"])
    vi.mocked(getGroup).mockResolvedValue({
      groupId: "g-admin", name: "admin", isAdmin: true,
      createdAt: "", createdBy: "system",
    })
    const { resolvePermissions } = await import("@/lib/permissions")
    const perms = await resolvePermissions("user-1")
    expect(perms.isAdmin).toBe(true)
    expect(perms.canRead).toBe(true)
  })

  it("returns org permissions for non-admin user", async () => {
    vi.mocked(getGroupsForUser).mockResolvedValue(["g-editors"])
    vi.mocked(getGroup).mockResolvedValue({
      groupId: "g-editors", name: "editors", isAdmin: false,
      createdAt: "", createdBy: "user-1",
    })
    vi.mocked(getOrgGroups).mockResolvedValue([
      {
        orgId: "org-1", groupId: "g-editors",
        canRead: true, canWrite: true, canManageUsers: false, canConfigureIntegrations: false,
      },
    ])
    const { resolvePermissions } = await import("@/lib/permissions")
    const perms = await resolvePermissions("user-1", "org-1")
    expect(perms.isAdmin).toBe(false)
    expect(perms.canRead).toBe(true)
    expect(perms.canWrite).toBe(true)
    expect(perms.canManageUsers).toBe(false)
  })
})
