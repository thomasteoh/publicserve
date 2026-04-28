import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCreateEntity = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/azure-tables", () => ({
  getTableClient: vi.fn(() => ({ createEntity: mockCreateEntity })),
}))

describe("writeLog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateEntity.mockResolvedValue(undefined)
  })

  it("creates entity with correct partition key and fields", async () => {
    const { writeLog } = await import("@/lib/logging")
    writeLog("auth", "info", "user signed in", { userId: "u1" })
    await vi.waitFor(() => expect(mockCreateEntity).toHaveBeenCalled())

    const entity = mockCreateEntity.mock.calls[0][0]
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    expect(entity.partitionKey).toBe(`auth#${today}`)
    expect(entity.category).toBe("auth")
    expect(entity.level).toBe("info")
    expect(entity.message).toBe("user signed in")
    expect(entity.userId).toBe("u1")
    expect(entity.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("promotes userId and orgId to top-level, serialises rest as metadata", async () => {
    const { writeLog } = await import("@/lib/logging")
    writeLog("crawl", "error", "crawl error", {
      userId: "u2",
      orgId: "o1",
      locationId: "loc1",
    })
    await vi.waitFor(() => expect(mockCreateEntity).toHaveBeenCalled())

    const entity = mockCreateEntity.mock.calls[0][0]
    expect(entity.userId).toBe("u2")
    expect(entity.orgId).toBe("o1")
    expect(JSON.parse(entity.metadata as string)).toEqual({ locationId: "loc1" })
  })

  it("omits metadata field when no extra fields provided", async () => {
    const { writeLog } = await import("@/lib/logging")
    writeLog("serve", "info", "record served")
    await vi.waitFor(() => expect(mockCreateEntity).toHaveBeenCalled())

    const entity = mockCreateEntity.mock.calls[0][0]
    expect(entity.metadata).toBeUndefined()
  })

  it("does not throw when table write fails", async () => {
    mockCreateEntity.mockRejectedValueOnce(new Error("network error"))
    const { writeLog } = await import("@/lib/logging")
    expect(() => writeLog("auth", "info", "test")).not.toThrow()
    await new Promise((r) => setTimeout(r, 50))
  })
})
