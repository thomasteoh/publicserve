// tests/lib/admin-logs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockListEntities = vi.fn()

vi.mock("@/lib/azure-tables", () => ({
  getTableClient: vi.fn(() => ({ listEntities: mockListEntities })),
}))

describe("queryLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListEntities.mockReturnValue((async function* () {})())
  })

  it("returns empty entries when no logs exist", async () => {
    const { queryLogs } = await import("@/lib/admin-logs")
    const result = await queryLogs({
      category: "auth",
      from: "2026-04-28",
      to: "2026-04-28",
    })
    expect(result.entries).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })

  it("queries correct partition when category and date specified", async () => {
    const { queryLogs } = await import("@/lib/admin-logs")
    await queryLogs({ category: "auth", from: "2026-04-28", to: "2026-04-28" })
    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        queryOptions: expect.objectContaining({
          filter: expect.stringContaining("auth#20260428"),
        }),
      })
    )
  })

  it("appends RowKey cursor filter when cursor provided", async () => {
    const { queryLogs } = await import("@/lib/admin-logs")
    // New cursor format: "{date}_{catIdx}_{rowKey}"
    await queryLogs({
      category: "auth",
      from: "2026-04-28",
      to: "2026-04-28",
      cursor: "20260428_0_9007199250000000-abcd",
    })
    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        queryOptions: expect.objectContaining({
          filter: expect.stringContaining(
            "RowKey gt '9007199250000000-abcd'"
          ),
        }),
      })
    )
  })

  it("stops at 50 entries and returns nextCursor with position", async () => {
    mockListEntities.mockReturnValue(
      (async function* () {
        for (let i = 0; i < 55; i++) {
          yield {
            rowKey: String(i).padStart(5, "0"),
            category: "auth",
            level: "info",
            message: "test",
            timestamp: new Date().toISOString(),
          }
        }
      })()
    )
    const { queryLogs } = await import("@/lib/admin-logs")
    const result = await queryLogs({
      category: "auth",
      from: "2026-04-28",
      to: "2026-04-28",
    })
    expect(result.entries).toHaveLength(50)
    // Cursor encodes date_catIdx_rowKey
    expect(result.nextCursor).toBe("20260428_0_00049")
  })
})
