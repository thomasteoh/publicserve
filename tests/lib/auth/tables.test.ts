// tests/lib/auth/tables.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetEntity = vi.fn()
const mockUpsertEntity = vi.fn()
const mockDeleteEntity = vi.fn()
const mockListEntities = vi.fn()

vi.mock("@/lib/azure-tables", () => ({
  getTableClient: vi.fn(() => ({
    getEntity: mockGetEntity,
    upsertEntity: mockUpsertEntity,
    deleteEntity: mockDeleteEntity,
    listEntities: mockListEntities,
  })),
}))

describe("tableGet", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns entity when found", async () => {
    mockGetEntity.mockResolvedValue({ partitionKey: "user", rowKey: "123", email: "a@b.com" })
    const { tableGet } = await import("@/lib/auth/tables")
    const result = await tableGet("Users", "user", "123")
    expect(result).toEqual({ partitionKey: "user", rowKey: "123", email: "a@b.com" })
  })

  it("returns null on ResourceNotFound", async () => {
    mockGetEntity.mockRejectedValue({ statusCode: 404 })
    const { tableGet } = await import("@/lib/auth/tables")
    const result = await tableGet("Users", "user", "notfound")
    expect(result).toBeNull()
  })
})

describe("tableUpsert", () => {
  it("calls upsertEntity with merge mode", async () => {
    mockUpsertEntity.mockResolvedValue(undefined)
    const { tableUpsert } = await import("@/lib/auth/tables")
    await tableUpsert("Users", { partitionKey: "user", rowKey: "123", email: "a@b.com" })
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      { partitionKey: "user", rowKey: "123", email: "a@b.com" },
      "Merge"
    )
  })
})
