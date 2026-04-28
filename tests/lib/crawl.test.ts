// tests/lib/crawl.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "crypto"

vi.mock("@/lib/logging", () => ({ writeLog: vi.fn() }))

vi.mock("@/lib/storage/records", () => ({
  upsertRecord: vi.fn(),
  markStaleRecords: vi.fn(() => Promise.resolve(1)),
  recordRowKey: (id: string, path: string) =>
    createHash("sha256").update(`${id}:${path}`).digest("hex"),
}))

vi.mock("@/lib/keyvault", () => ({
  getSecret: vi.fn(() => Promise.resolve({ type: "storage_key", accountKey: "k" })),
}))

vi.mock("@/lib/storage/factory", () => ({
  createBackend: vi.fn(() => ({
    async *list() {
      yield { path: "report.html", sizeBytes: 500, lastModified: new Date() }
      yield { path: "data.json", sizeBytes: 200, lastModified: new Date() }
    },
  })),
}))

import { upsertRecord, markStaleRecords } from "@/lib/storage/records"

describe("runCrawl", () => {
  beforeEach(() => vi.clearAllMocks())

  it("upserts only .html files and marks stale", async () => {
    const { runCrawl } = await import("@/lib/storage/crawl")
    const location = {
      storageLocationId: "loc-1",
      orgId: "org-1",
      rootPath: "container/path",
      credentialRef: "storage-cred-loc-1",
      type: "azure_blob",
    } as never
    const result = await runCrawl(location)
    expect(upsertRecord).toHaveBeenCalledTimes(1)  // only .html
    expect(upsertRecord).toHaveBeenCalledWith(
      "loc-1",
      "org-1",
      expect.objectContaining({ path: "report.html", sizeBytes: 500 }),
      undefined
    )
    expect(markStaleRecords).toHaveBeenCalledWith("loc-1", new Set(["report.html"]))
    expect(result.added + result.updated).toBe(1)
    expect(result.stale).toBe(1)
  })
})
