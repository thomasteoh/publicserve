// tests/lib/storage/records.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockTableGet = vi.fn()
const mockTableUpsert = vi.fn()

vi.mock("@/lib/auth/tables", () => ({
  tableGet: mockTableGet,
  tableUpsert: mockTableUpsert,
  tableList: vi.fn(() => Promise.resolve([])),
  tableDelete: vi.fn(),
}))

describe("upsertRecord", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns isNew: true when record does not exist", async () => {
    mockTableGet.mockResolvedValue(null)
    mockTableUpsert.mockResolvedValue(undefined)
    const { upsertRecord } = await import("@/lib/storage/records")
    const result = await upsertRecord(
      "loc-1",
      "org-1",
      { path: "index.html", sizeBytes: 100, lastModified: new Date() },
      undefined
    )
    expect(result.isNew).toBe(true)
  })

  it("returns isNew: false when record already exists", async () => {
    mockTableGet.mockResolvedValue({
      partitionKey: "loc-1",
      rowKey: "abc",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    mockTableUpsert.mockResolvedValue(undefined)
    const { upsertRecord } = await import("@/lib/storage/records")
    const result = await upsertRecord(
      "loc-1",
      "org-1",
      { path: "index.html", sizeBytes: 200, lastModified: new Date() },
      undefined
    )
    expect(result.isNew).toBe(false)
  })

  it("preserves createdAt from existing record on update", async () => {
    const createdAt = "2026-01-01T00:00:00.000Z"
    mockTableGet.mockResolvedValue({ partitionKey: "loc-1", rowKey: "abc", createdAt })
    mockTableUpsert.mockResolvedValue(undefined)
    const { upsertRecord } = await import("@/lib/storage/records")
    await upsertRecord("loc-1", "org-1", {
      path: "index.html",
      sizeBytes: 200,
      lastModified: new Date(),
    })
    expect(mockTableUpsert).toHaveBeenCalledWith(
      "Records",
      expect.objectContaining({ createdAt })
    )
  })
})
