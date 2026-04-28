// tests/lib/identity/groups.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth/tables", () => ({
  tableGet: vi.fn(),
  tableUpsert: vi.fn(),
  tableList: vi.fn(),
  tableDelete: vi.fn(),
}))

import { tableGet, tableUpsert, tableList } from "@/lib/auth/tables"

describe("getGroup", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns group by id", async () => {
    vi.mocked(tableGet).mockResolvedValue({
      partitionKey: "group", rowKey: "g1", name: "admin", isAdmin: true,
      createdAt: "2026-01-01T00:00:00Z", createdBy: "system",
    } as Record<string, unknown> & { partitionKey: string; rowKey: string })
    const { getGroup } = await import("@/lib/identity/groups")
    const group = await getGroup("g1")
    expect(group?.name).toBe("admin")
    expect(group?.isAdmin).toBe(true)
  })
})

describe("createGroup", () => {
  it("upserts group entity and returns group", async () => {
    vi.mocked(tableUpsert).mockResolvedValue(undefined)
    const { createGroup } = await import("@/lib/identity/groups")
    const group = await createGroup({ name: "editors", isAdmin: false, createdBy: "user-1" })
    expect(tableUpsert).toHaveBeenCalledWith(
      "Groups",
      expect.objectContaining({ partitionKey: "group", name: "editors", isAdmin: false })
    )
    expect(group.name).toBe("editors")
  })
})
