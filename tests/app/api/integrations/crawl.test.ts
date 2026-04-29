/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockValidateApiKey = vi.fn()
const mockRecordTrigger = vi.fn()
const mockGetOrg = vi.fn()
const mockListStorageLocations = vi.fn()
const mockRunCrawl = vi.fn()
const mockWriteLog = vi.fn()

vi.mock("@/lib/identity/api-keys", () => ({
  validateApiKey: mockValidateApiKey,
  recordTrigger: mockRecordTrigger,
}))
vi.mock("@/lib/identity/orgs", () => ({ getOrg: mockGetOrg }))
vi.mock("@/lib/storage/locations", () => ({ listStorageLocations: mockListStorageLocations }))
vi.mock("@/lib/storage/crawl", () => ({ runCrawl: mockRunCrawl }))
vi.mock("@/lib/logging", () => ({ writeLog: mockWriteLog }))

function makeReq(body: unknown, token?: string) {
  return new Request("http://localhost/api/integrations/crawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/integrations/crawl", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when Authorization header is missing", async () => {
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(new Request("http://localhost/api/integrations/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }))
    expect(res.status).toBe(401)
  })

  it("returns 401 when Authorization scheme is not Bearer", async () => {
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(new Request("http://localhost/api/integrations/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic abc" },
      body: "{}",
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when orgId is missing from body", async () => {
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({}, "ps_somekey"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when body is not valid JSON", async () => {
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(new Request("http://localhost/api/integrations/crawl", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ps_somekey",
      },
      body: "{broken",
    }))
    expect(res.status).toBe(400)
  })

  it("returns 401 when api key is invalid", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: false })
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_badkey"))
    expect(res.status).toBe(401)
    expect(mockWriteLog).toHaveBeenCalledWith(
      "permission_denied", "warn", "invalid api key", { orgId: "org-1" }
    )
  })

  it("returns 429 with Retry-After header when within cooldown", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true, cooldownRemaining: 45 })
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("45")
    expect(mockWriteLog).toHaveBeenCalledWith(
      "permission_denied", "warn", "api crawl rate limited", { orgId: "org-1" }
    )
  })

  it("returns 404 when org not found", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true })
    mockGetOrg.mockResolvedValue(null)
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(404)
  })

  it("returns 422 when org has no storage locations", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true })
    mockGetOrg.mockResolvedValue({ orgId: "org-1", name: "Org One" })
    mockListStorageLocations.mockResolvedValue([])
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(422)
  })

  it("returns 202 with locationCount and triggers crawl fire-and-forget", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true })
    mockGetOrg.mockResolvedValue({ orgId: "org-1", name: "Org One" })
    const loc1 = { storageLocationId: "loc-1", orgId: "org-1" }
    const loc2 = { storageLocationId: "loc-2", orgId: "org-1" }
    mockListStorageLocations.mockResolvedValue([loc1, loc2])
    mockRecordTrigger.mockResolvedValue(undefined)
    mockRunCrawl.mockResolvedValue({ added: 1, updated: 0, stale: 0, unchanged: 0 })
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ orgId: "org-1", locationCount: 2 })
    expect(mockRecordTrigger).toHaveBeenCalledWith("org-1")
    expect(mockWriteLog).toHaveBeenCalledWith(
      "crawl", "info", "api-triggered crawl started", { orgId: "org-1", locationCount: 2 }
    )
  })

  it("logs crawl error when some locations fail", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true })
    mockGetOrg.mockResolvedValue({ orgId: "org-1", name: "Org One" })
    const loc1 = { storageLocationId: "loc-1", orgId: "org-1" }
    const loc2 = { storageLocationId: "loc-2", orgId: "org-1" }
    mockListStorageLocations.mockResolvedValue([loc1, loc2])
    mockRecordTrigger.mockResolvedValue(undefined)
    mockRunCrawl.mockResolvedValue({ added: 1, updated: 0, stale: 0, unchanged: 0 })
    mockRunCrawl.mockRejectedValueOnce(new Error("connection refused"))
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ orgId: "org-1", locationCount: 2 })
    expect(mockWriteLog).toHaveBeenCalledWith(
      "crawl", "error", "crawl completed with errors", { orgId: "org-1", failed: 1 }
    )
  })
})
