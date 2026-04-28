// tests/lib/storage/locations.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth/tables", () => ({
  tableGet: vi.fn(),
  tableUpsert: vi.fn(),
  tableList: vi.fn(),
  tableDelete: vi.fn(),
}))

import { tableUpsert, tableList } from "@/lib/auth/tables"

describe("createStorageLocation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("upserts entity and returns location with generated id", async () => {
    vi.mocked(tableUpsert).mockResolvedValue(undefined)
    const { createStorageLocation } = await import("@/lib/storage/locations")
    const loc = await createStorageLocation({
      orgId: "org-1",
      name: "My Bucket",
      type: "s3",
      rootPath: "my-bucket/reports",
      createdBy: "user-1",
    })
    expect(tableUpsert).toHaveBeenCalledWith(
      "StorageLocations",
      expect.objectContaining({ partitionKey: "org-1", name: "My Bucket", type: "s3" })
    )
    expect(loc.storageLocationId).toBeTruthy()
    expect(loc.credentialRef).toBe(`storage-cred-${loc.storageLocationId}`)
  })
})

describe("listStorageLocations", () => {
  it("returns all locations for org", async () => {
    vi.mocked(tableList).mockResolvedValue([
      { partitionKey: "org-1", rowKey: "loc-1", name: "Loc A", type: "azure_blob",
        rootPath: "c/path", credentialRef: "storage-cred-loc-1", createdAt: "", createdBy: "u1" },
    ])
    const { listStorageLocations } = await import("@/lib/storage/locations")
    const locs = await listStorageLocations("org-1")
    expect(locs).toHaveLength(1)
    expect(locs[0].name).toBe("Loc A")
  })
})
