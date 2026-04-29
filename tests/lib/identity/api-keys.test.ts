import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "crypto"

vi.mock("@/lib/auth/tables", () => ({
  tableGet: vi.fn(),
  tableUpsert: vi.fn(),
  tableDelete: vi.fn(),
}))

import { tableGet, tableUpsert, tableDelete } from "@/lib/auth/tables"

describe("generateApiKey", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns rawKey starting with ps_ followed by 64 hex chars", async () => {
    vi.mocked(tableUpsert).mockResolvedValue(undefined)
    const { generateApiKey } = await import("@/lib/identity/api-keys")
    const result = await generateApiKey("org-1", "user-1")
    expect(result.rawKey).toMatch(/^ps_[0-9a-f]{64}$/)
    expect(result.keyPrefix).toBe(result.rawKey.slice(0, 11))
    expect(result.createdAt).toBeTruthy()
  })

  it("stores SHA-256 hash and nulls lastTriggeredAt", async () => {
    vi.mocked(tableUpsert).mockResolvedValue(undefined)
    const { generateApiKey } = await import("@/lib/identity/api-keys")
    const result = await generateApiKey("org-1", "user-1")
    const expectedHash = createHash("sha256").update(result.rawKey).digest("hex")
    expect(tableUpsert).toHaveBeenCalledWith(
      "OrgApiKeys",
      expect.objectContaining({
        partitionKey: "org-1",
        rowKey: "key",
        keyHash: expectedHash,
        keyPrefix: result.rawKey.slice(0, 11),
        createdBy: "user-1",
        lastTriggeredAt: null,
      })
    )
  })
})

describe("getApiKeyMeta", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null when no row exists", async () => {
    vi.mocked(tableGet).mockResolvedValue(null)
    const { getApiKeyMeta } = await import("@/lib/identity/api-keys")
    expect(await getApiKeyMeta("org-1")).toBeNull()
  })

  it("returns metadata without keyHash", async () => {
    vi.mocked(tableGet).mockResolvedValue({
      partitionKey: "org-1",
      rowKey: "key",
      keyHash: "secret-hash",
      keyPrefix: "ps_1a2b3c4d",
      createdAt: "2026-04-29T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    } as Record<string, unknown> & { partitionKey: string; rowKey: string })
    const { getApiKeyMeta } = await import("@/lib/identity/api-keys")
    const meta = await getApiKeyMeta("org-1")
    expect(meta).toEqual({
      keyPrefix: "ps_1a2b3c4d",
      createdAt: "2026-04-29T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    })
    expect(meta).not.toHaveProperty("keyHash")
  })
})

describe("validateApiKey", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns invalid when no key row exists", async () => {
    vi.mocked(tableGet).mockResolvedValue(null)
    const { validateApiKey } = await import("@/lib/identity/api-keys")
    expect(await validateApiKey("org-1", "ps_abc")).toEqual({ valid: false })
  })

  it("returns invalid when hash does not match", async () => {
    vi.mocked(tableGet).mockResolvedValue({
      partitionKey: "org-1",
      rowKey: "key",
      keyHash: "wronghash",
      keyPrefix: "ps_1a2b3c4d",
      createdAt: "2026-04-29T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    } as Record<string, unknown> & { partitionKey: string; rowKey: string })
    const { validateApiKey } = await import("@/lib/identity/api-keys")
    expect(await validateApiKey("org-1", "ps_wrongkey")).toEqual({ valid: false })
  })

  it("returns valid with no cooldown when never triggered", async () => {
    const testKey = "ps_" + "a".repeat(64)
    const hash = createHash("sha256").update(testKey).digest("hex")
    vi.mocked(tableGet).mockResolvedValue({
      partitionKey: "org-1",
      rowKey: "key",
      keyHash: hash,
      keyPrefix: "ps_aaaaaaaa",
      createdAt: "2026-04-29T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    } as Record<string, unknown> & { partitionKey: string; rowKey: string })
    const { validateApiKey } = await import("@/lib/identity/api-keys")
    expect(await validateApiKey("org-1", testKey)).toEqual({ valid: true })
  })

  it("returns valid with cooldownRemaining when triggered within 60s", async () => {
    const testKey = "ps_" + "b".repeat(64)
    const hash = createHash("sha256").update(testKey).digest("hex")
    const recentlyTriggered = new Date(Date.now() - 30_000).toISOString()
    vi.mocked(tableGet).mockResolvedValue({
      partitionKey: "org-1",
      rowKey: "key",
      keyHash: hash,
      keyPrefix: "ps_bbbbbbbb",
      createdAt: "2026-04-29T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: recentlyTriggered,
    } as Record<string, unknown> & { partitionKey: string; rowKey: string })
    const { validateApiKey } = await import("@/lib/identity/api-keys")
    const result = await validateApiKey("org-1", testKey)
    expect(result.valid).toBe(true)
    expect(result.cooldownRemaining).toBeGreaterThan(0)
    expect(result.cooldownRemaining).toBeLessThanOrEqual(30)
  })
})

describe("revokeApiKey", () => {
  it("calls tableDelete with correct params", async () => {
    vi.mocked(tableDelete).mockResolvedValue(undefined)
    const { revokeApiKey } = await import("@/lib/identity/api-keys")
    await revokeApiKey("org-1")
    expect(tableDelete).toHaveBeenCalledWith("OrgApiKeys", "org-1", "key")
  })
})

describe("recordTrigger", () => {
  it("upserts lastTriggeredAt for org", async () => {
    vi.mocked(tableUpsert).mockResolvedValue(undefined)
    const before = Date.now()
    const { recordTrigger } = await import("@/lib/identity/api-keys")
    await recordTrigger("org-1")
    const call = vi.mocked(tableUpsert).mock.calls[0]
    const row = call[1] as Record<string, unknown>
    expect(call[0]).toBe("OrgApiKeys")
    expect(row).toMatchObject({ partitionKey: "org-1", rowKey: "key" })
    const ts = new Date(row.lastTriggeredAt as string).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
  })
})
