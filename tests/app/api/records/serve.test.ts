/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.fn()
const mockResolvePermissions = vi.fn()
const mockGetRecord = vi.fn()
const mockGetStorageLocation = vi.fn()
const mockGetSecret = vi.fn()
const mockCreateBackend = vi.fn()
const mockWriteLog = vi.fn()

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/permissions", () => ({ resolvePermissions: mockResolvePermissions }))
vi.mock("@/lib/storage/records", () => ({ getRecord: mockGetRecord }))
vi.mock("@/lib/storage/locations", () => ({ getStorageLocation: mockGetStorageLocation }))
vi.mock("@/lib/keyvault", () => ({ getSecret: mockGetSecret }))
vi.mock("@/lib/storage/factory", () => ({ createBackend: mockCreateBackend }))
vi.mock("@/lib/logging", () => ({ writeLog: mockWriteLog }))

const staleRecord = {
  partitionKey: "loc1",
  rowKey: "rk1",
  storageLocationId: "loc1",
  orgId: "org1",
  path: "mycontainer/reports/index.html",
  sizeBytes: 100,
  lastModified: new Date().toISOString(),
  stale: true,
  lastCrawledAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
}

const freshRecord = { ...staleRecord, stale: false }

function makeParams(locationId: string, recordRK: string) {
  return { params: Promise.resolve({ locationId, recordRK }) }
}

describe("GET /api/records/[locationId]/[recordRK]/serve", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import(
      "@/app/api/records/[locationId]/[recordRK]/serve/route"
    )
    const res = await GET(new Request("http://localhost/"), makeParams("loc1", "rk1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when record not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockGetRecord.mockResolvedValue(null)
    const { GET } = await import(
      "@/app/api/records/[locationId]/[recordRK]/serve/route"
    )
    const res = await GET(new Request("http://localhost/"), makeParams("loc1", "rk1"))
    expect(res.status).toBe(404)
  })

  it("returns 410 when record is stale", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockGetRecord.mockResolvedValue(staleRecord)
    mockResolvePermissions.mockResolvedValue({ isAdmin: true, canRead: true })
    const { GET } = await import(
      "@/app/api/records/[locationId]/[recordRK]/serve/route"
    )
    const res = await GET(new Request("http://localhost/"), makeParams("loc1", "rk1"))
    expect(res.status).toBe(410)
  })

  it("does not return 410 when record is not stale", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockGetRecord.mockResolvedValue(freshRecord)
    mockResolvePermissions.mockResolvedValue({ isAdmin: true, canRead: true })
    mockGetStorageLocation.mockResolvedValue({
      storageLocationId: "loc1",
      orgId: "org1",
      rootPath: "myaccount/mycontainer",
      credentialRef: "cred-ref",
      type: "azure_blob",
    })
    mockGetSecret.mockResolvedValue({ type: "storage_key", accountKey: "k" })
    mockCreateBackend.mockReturnValue({
      getSignedUrl: vi.fn(() => Promise.resolve("https://signed.url")),
    })
    const { GET } = await import(
      "@/app/api/records/[locationId]/[recordRK]/serve/route"
    )
    const res = await GET(new Request("http://localhost/"), makeParams("loc1", "rk1"))
    expect(res.status).not.toBe(410)
  })
})
