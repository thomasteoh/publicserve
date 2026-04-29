/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.fn()
const mockResolvePermissions = vi.fn()
const mockGetApiKeyMeta = vi.fn()
const mockGenerateApiKey = vi.fn()
const mockRevokeApiKey = vi.fn()
const mockWriteLog = vi.fn()

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/permissions", () => ({ resolvePermissions: mockResolvePermissions }))
vi.mock("@/lib/identity/api-keys", () => ({
  getApiKeyMeta: mockGetApiKeyMeta,
  generateApiKey: mockGenerateApiKey,
  revokeApiKey: mockRevokeApiKey,
}))
vi.mock("@/lib/logging", () => ({ writeLog: mockWriteLog }))

const NO_ACCESS = {
  isAdmin: false, canRead: false, canWrite: false,
  canManageUsers: false, canConfigureIntegrations: false,
}
const CAN_INTEGRATE = { ...NO_ACCESS, canConfigureIntegrations: true }

function makeParams(orgId: string) {
  return { params: Promise.resolve({ orgId }) }
}

describe("GET /api/orgs/[orgId]/api-key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when no canConfigureIntegrations", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(NO_ACCESS)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(403)
  })

  it("returns 404 when no key exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockGetApiKeyMeta.mockResolvedValue(null)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(404)
  })

  it("returns key metadata when key exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    const meta = {
      keyPrefix: "ps_1a2b3c4d",
      createdAt: "2026-04-29T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    }
    mockGetApiKeyMeta.mockResolvedValue(meta)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(meta)
  })
})

describe("POST /api/orgs/[orgId]/api-key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when no canConfigureIntegrations", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(NO_ACCESS)
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(403)
  })

  it("generates key and returns 201 with rawKey", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockGetApiKeyMeta.mockResolvedValue(null)
    const keyResult = {
      rawKey: "ps_" + "a".repeat(64),
      keyPrefix: "ps_aaaaaaaa",
      createdAt: "2026-04-29T00:00:00.000Z",
    }
    mockGenerateApiKey.mockResolvedValue(keyResult)
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(keyResult)
    expect(mockWriteLog).toHaveBeenCalledWith("auth", "info", "api key generated",
      expect.objectContaining({ orgId: "org-1" }))
  })

  it("logs rotation warning when key already exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockGetApiKeyMeta.mockResolvedValue({
      keyPrefix: "ps_old00000",
      createdAt: "2026-04-28T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    })
    mockGenerateApiKey.mockResolvedValue({
      rawKey: "ps_" + "b".repeat(64),
      keyPrefix: "ps_bbbbbbbb",
      createdAt: "2026-04-29T00:00:00.000Z",
    })
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(mockWriteLog).toHaveBeenCalledWith("auth", "warn", "api key rotated",
      expect.objectContaining({ orgId: "org-1" }))
  })
})

describe("DELETE /api/orgs/[orgId]/api-key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 204 and calls revokeApiKey", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockRevokeApiKey.mockResolvedValue(undefined)
    const { DELETE } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await DELETE(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(204)
    expect(mockRevokeApiKey).toHaveBeenCalledWith("org-1")
    expect(mockWriteLog).toHaveBeenCalledWith("auth", "warn", "api key revoked",
      expect.objectContaining({ orgId: "org-1" }))
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { DELETE } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await DELETE(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(401)
  })
})
