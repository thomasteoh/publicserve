/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.fn()
const mockResolvePermissions = vi.fn()
const mockQueryLogs = vi.fn()

vi.mock("@/auth", () => ({
  auth: mockAuth,
}))
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: mockResolvePermissions,
}))
vi.mock("@/lib/admin-logs", () => ({
  queryLogs: mockQueryLogs,
}))

const FULL_ACCESS = {
  isAdmin: true,
  canRead: true,
  canWrite: true,
  canManageUsers: true,
  canConfigureIntegrations: true,
}
const NO_ACCESS = {
  isAdmin: false,
  canRead: false,
  canWrite: false,
  canManageUsers: false,
  canConfigureIntegrations: false,
}

describe("GET /api/admin/logs", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import("@/app/api/admin/logs/route")
    const res = await GET(new Request("http://localhost/api/admin/logs"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when authenticated but not admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(NO_ACCESS)
    const { GET } = await import("@/app/api/admin/logs/route")
    const res = await GET(new Request("http://localhost/api/admin/logs"))
    expect(res.status).toBe(403)
  })

  it("returns 200 with query results for admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(FULL_ACCESS)
    mockQueryLogs.mockResolvedValue({ entries: [], nextCursor: null })
    const { GET } = await import("@/app/api/admin/logs/route")
    const res = await GET(new Request("http://localhost/api/admin/logs"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entries: [], nextCursor: null })
  })

  it("passes all query params to queryLogs", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(FULL_ACCESS)
    mockQueryLogs.mockResolvedValue({ entries: [], nextCursor: null })
    const { GET } = await import("@/app/api/admin/logs/route")
    await GET(
      new Request(
        "http://localhost/api/admin/logs?category=crawl&from=2026-04-01&to=2026-04-28&cursor=abc"
      )
    )
    expect(mockQueryLogs).toHaveBeenCalledWith({
      category: "crawl",
      from: "2026-04-01",
      to: "2026-04-28",
      cursor: "abc",
    })
  })
})
