// tests/lib/auth/adapter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { randomUUID } from "crypto"

vi.mock("@/lib/auth/tables", () => ({
  tableGet: vi.fn(),
  tableUpsert: vi.fn(),
  tableDelete: vi.fn(),
  tableList: vi.fn(),
}))

import { tableGet, tableUpsert, tableDelete, tableList } from "@/lib/auth/tables"

describe("AzureTablesAdapter", () => {
  beforeEach(() => vi.clearAllMocks())

  it("createUser upserts to Users table and returns user", async () => {
    vi.mocked(tableUpsert).mockResolvedValue(undefined)
    const { AzureTablesAdapter } = await import("@/lib/auth/adapter")
    const adapter = AzureTablesAdapter()
    const user = await adapter.createUser!({ email: "test@example.com", emailVerified: null })
    expect(tableUpsert).toHaveBeenCalledWith(
      "Users",
      expect.objectContaining({ partitionKey: "user", email: "test@example.com" })
    )
    expect(user.email).toBe("test@example.com")
    expect(user.id).toBeTruthy()
  })

  it("getUserByEmail returns null when not found", async () => {
    vi.mocked(tableList).mockResolvedValue([])
    const { AzureTablesAdapter } = await import("@/lib/auth/adapter")
    const adapter = AzureTablesAdapter()
    const result = await adapter.getUserByEmail!("missing@example.com")
    expect(result).toBeNull()
  })

  it("createSession upserts to Sessions table", async () => {
    vi.mocked(tableUpsert).mockResolvedValue(undefined)
    const { AzureTablesAdapter } = await import("@/lib/auth/adapter")
    const adapter = AzureTablesAdapter()
    const expires = new Date(Date.now() + 3600_000)
    const session = await adapter.createSession!({
      sessionToken: "tok123",
      userId: "user-1",
      expires,
    })
    expect(tableUpsert).toHaveBeenCalledWith(
      "Sessions",
      expect.objectContaining({ partitionKey: "session", rowKey: "tok123", userId: "user-1" })
    )
    expect(session.sessionToken).toBe("tok123")
  })
})
