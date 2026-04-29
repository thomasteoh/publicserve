# API Key + Crawl Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow external systems to trigger a full org storage crawl via a bearer-token API key, with session-authed key management endpoints for users with `canConfigureIntegrations`.

**Architecture:** One API key per org stored as a SHA-256 hash in Azure Table `OrgApiKeys` (PK=orgId, RK="key"). A standalone lib handles key operations. Two route groups: session-authed management at `/api/orgs/[orgId]/api-key` and bearer-authed trigger at `/api/integrations/crawl`. The trigger runs all org crawls fire-and-forget and returns 202 immediately.

**Tech Stack:** Next.js 15 App Router, Azure Table Storage (`@azure/data-tables` via `tableGet`/`tableUpsert`/`tableDelete` helpers), Node.js `crypto`, Vitest.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/identity/api-keys.ts` | Create | All key CRUD: generate, revoke, meta, validate, recordTrigger |
| `src/app/api/orgs/[orgId]/api-key/route.ts` | Create | GET/POST/DELETE — session-authed key management |
| `src/app/api/integrations/crawl/route.ts` | Create | POST — bearer-authed crawl trigger |
| `tests/lib/identity/api-keys.test.ts` | Create | Unit tests for api-keys lib |
| `tests/app/api/orgs/api-key.test.ts` | Create | Unit tests for key management route |
| `tests/app/api/integrations/crawl.test.ts` | Create | Unit tests for crawl trigger route |

**Existing files used (no changes):**
- `src/lib/auth/tables.ts` — `tableGet`, `tableUpsert`, `tableDelete`
- `src/lib/identity/orgs.ts` — `getOrg(orgId)`
- `src/lib/storage/locations.ts` — `listStorageLocations(orgId)`
- `src/lib/storage/crawl.ts` — `runCrawl(location)`
- `src/lib/logging.ts` — `writeLog()`
- `src/lib/permissions.ts` — `resolvePermissions()`

---

## Task 1: api-keys lib

**Files:**
- Create: `src/lib/identity/api-keys.ts`
- Test: `tests/lib/identity/api-keys.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/identity/api-keys.test.ts
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
    expect(call[0]).toBe("OrgApiKeys")
    expect(call[1]).toMatchObject({ partitionKey: "org-1", rowKey: "key" })
    const ts = new Date(call[1].lastTriggeredAt as string).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/lib/identity/api-keys.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/identity/api-keys'`

- [ ] **Step 3: Implement `src/lib/identity/api-keys.ts`**

```typescript
// src/lib/identity/api-keys.ts
import { randomBytes, createHash } from "crypto"
import { tableGet, tableUpsert, tableDelete } from "@/lib/auth/tables"

const TABLE = "OrgApiKeys"
const COOLDOWN_MS = 60_000

export interface ApiKeyMeta {
  keyPrefix: string
  createdAt: string
  createdBy: string
  lastTriggeredAt: string | null
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex")
}

export async function generateApiKey(
  orgId: string,
  userId: string
): Promise<{ rawKey: string; keyPrefix: string; createdAt: string }> {
  const rawKey = "ps_" + randomBytes(32).toString("hex")
  const keyPrefix = rawKey.slice(0, 11)
  const createdAt = new Date().toISOString()
  await tableUpsert(TABLE, {
    partitionKey: orgId,
    rowKey: "key",
    keyHash: hashKey(rawKey),
    keyPrefix,
    createdAt,
    createdBy: userId,
    lastTriggeredAt: null,
  })
  return { rawKey, keyPrefix, createdAt }
}

export async function revokeApiKey(orgId: string): Promise<void> {
  await tableDelete(TABLE, orgId, "key")
}

export async function getApiKeyMeta(orgId: string): Promise<ApiKeyMeta | null> {
  const row = await tableGet<Record<string, unknown>>(TABLE, orgId, "key")
  if (!row) return null
  return {
    keyPrefix: row.keyPrefix as string,
    createdAt: row.createdAt as string,
    createdBy: row.createdBy as string,
    lastTriggeredAt: (row.lastTriggeredAt as string | null) ?? null,
  }
}

export async function validateApiKey(
  orgId: string,
  rawKey: string
): Promise<{ valid: boolean; cooldownRemaining?: number }> {
  const row = await tableGet<Record<string, unknown>>(TABLE, orgId, "key")
  if (!row) return { valid: false }
  if (row.keyHash !== hashKey(rawKey)) return { valid: false }

  const lastTriggered = row.lastTriggeredAt as string | null
  if (lastTriggered) {
    const elapsed = Date.now() - new Date(lastTriggered).getTime()
    if (elapsed < COOLDOWN_MS) {
      return { valid: true, cooldownRemaining: Math.ceil((COOLDOWN_MS - elapsed) / 1000) }
    }
  }
  return { valid: true }
}

export async function recordTrigger(orgId: string): Promise<void> {
  await tableUpsert(TABLE, {
    partitionKey: orgId,
    rowKey: "key",
    lastTriggeredAt: new Date().toISOString(),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/lib/identity/api-keys.test.ts
```

Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/tteoh/publicserve && git add src/lib/identity/api-keys.ts tests/lib/identity/api-keys.test.ts
git commit -m "feat: add api-keys lib with generate/revoke/validate/recordTrigger"
```

---

## Task 2: Key management route

**Files:**
- Create: `src/app/api/orgs/[orgId]/api-key/route.ts`
- Test: `tests/app/api/orgs/api-key.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/app/api/orgs/api-key.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.fn()
const mockResolvePermissions = vi.fn()
const mockGetApiKeyMeta = vi.fn()
const mockGenerateApiKey = vi.fn()
const mockRevokeApiKey = vi.fn()
const mockWriteLog = vi.fn()

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/permissions", () => ({ resolvePermissions: mockResolvePermissions }))
vi.mock("@/lib/identity/api-keys", () => ({
  getApiKeyMeta: mockGetApiKeyMeta,
  generateApiKey: mockGenerateApiKey,
  revokeApiKey: mockRevokeApiKey,
}))
vi.mock("@/lib/logging", () => ({ writeLog: mockWriteLog }))

const NO_ACCESS = {
  isAdmin: false, canRead: false, canWrite: false,
  canManageUsers: false, canConfigureIntegrations: false,
}
const CAN_INTEGRATE = { ...NO_ACCESS, canConfigureIntegrations: true }

function makeParams(orgId: string) {
  return { params: Promise.resolve({ orgId }) }
}

describe("GET /api/orgs/[orgId]/api-key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when no canConfigureIntegrations", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(NO_ACCESS)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(403)
  })

  it("returns null when no key exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockGetApiKeyMeta.mockResolvedValue(null)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it("returns key metadata when key exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    const meta = {
      keyPrefix: "ps_1a2b3c4d",
      createdAt: "2026-04-29T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    }
    mockGetApiKeyMeta.mockResolvedValue(meta)
    const { GET } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await GET(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(meta)
  })
})

describe("POST /api/orgs/[orgId]/api-key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when no canConfigureIntegrations", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(NO_ACCESS)
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(403)
  })

  it("generates key and returns 201 with rawKey", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockGetApiKeyMeta.mockResolvedValue(null)
    const keyResult = {
      rawKey: "ps_" + "a".repeat(64),
      keyPrefix: "ps_aaaaaaaa",
      createdAt: "2026-04-29T00:00:00.000Z",
    }
    mockGenerateApiKey.mockResolvedValue(keyResult)
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(keyResult)
    expect(mockWriteLog).toHaveBeenCalledWith("auth", "info", "api key generated",
      expect.objectContaining({ orgId: "org-1" }))
  })

  it("logs rotation warning when key already exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockGetApiKeyMeta.mockResolvedValue({
      keyPrefix: "ps_old00000",
      createdAt: "2026-04-28T00:00:00.000Z",
      createdBy: "u1",
      lastTriggeredAt: null,
    })
    mockGenerateApiKey.mockResolvedValue({
      rawKey: "ps_" + "b".repeat(64),
      keyPrefix: "ps_bbbbbbbb",
      createdAt: "2026-04-29T00:00:00.000Z",
    })
    const { POST } = await import("@/app/api/orgs/[orgId]/api-key/route")
    await POST(new Request("http://localhost"), makeParams("org-1"))
    expect(mockWriteLog).toHaveBeenCalledWith("auth", "warn", "api key rotated",
      expect.objectContaining({ orgId: "org-1" }))
  })
})

describe("DELETE /api/orgs/[orgId]/api-key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 204 and calls revokeApiKey", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } })
    mockResolvePermissions.mockResolvedValue(CAN_INTEGRATE)
    mockRevokeApiKey.mockResolvedValue(undefined)
    const { DELETE } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await DELETE(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(204)
    expect(mockRevokeApiKey).toHaveBeenCalledWith("org-1")
    expect(mockWriteLog).toHaveBeenCalledWith("auth", "warn", "api key revoked",
      expect.objectContaining({ orgId: "org-1" }))
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { DELETE } = await import("@/app/api/orgs/[orgId]/api-key/route")
    const res = await DELETE(new Request("http://localhost"), makeParams("org-1"))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/app/api/orgs/api-key.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/orgs/[orgId]/api-key/route'`

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/orgs/[orgId]/api-key/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { generateApiKey, revokeApiKey, getApiKeyMeta } from "@/lib/identity/api-keys"
import { writeLog } from "@/lib/logging"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return NextResponse.json(await getApiKeyMeta(orgId))
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const existing = await getApiKeyMeta(orgId)
  const result = await generateApiKey(orgId, session.user.id)
  writeLog(
    "auth",
    existing ? "warn" : "info",
    existing ? "api key rotated" : "api key generated",
    { orgId, userId: session.user.id }
  )
  return NextResponse.json(result, { status: 201 })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  await revokeApiKey(orgId)
  writeLog("auth", "warn", "api key revoked", { orgId, userId: session.user.id })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/app/api/orgs/api-key.test.ts
```

Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/tteoh/publicserve && git add src/app/api/orgs/[orgId]/api-key/route.ts tests/app/api/orgs/api-key.test.ts
git commit -m "feat: add session-authed api key management endpoints"
```

---

## Task 3: Crawl trigger endpoint

**Files:**
- Create: `src/app/api/integrations/crawl/route.ts`
- Test: `tests/app/api/integrations/crawl.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/app/api/integrations/crawl.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockValidateApiKey = vi.fn()
const mockRecordTrigger = vi.fn()
const mockGetOrg = vi.fn()
const mockListStorageLocations = vi.fn()
const mockRunCrawl = vi.fn()
const mockWriteLog = vi.fn()

vi.mock("@/lib/identity/api-keys", () => ({
  validateApiKey: mockValidateApiKey,
  recordTrigger: mockRecordTrigger,
}))
vi.mock("@/lib/identity/orgs", () => ({ getOrg: mockGetOrg }))
vi.mock("@/lib/storage/locations", () => ({ listStorageLocations: mockListStorageLocations }))
vi.mock("@/lib/storage/crawl", () => ({ runCrawl: mockRunCrawl }))
vi.mock("@/lib/logging", () => ({ writeLog: mockWriteLog }))

function makeReq(body: unknown, token?: string) {
  return new Request("http://localhost/api/integrations/crawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/integrations/crawl", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when Authorization header is missing", async () => {
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(new Request("http://localhost/api/integrations/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }))
    expect(res.status).toBe(401)
  })

  it("returns 401 when Authorization scheme is not Bearer", async () => {
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(new Request("http://localhost/api/integrations/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic abc" },
      body: "{}",
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when orgId is missing from body", async () => {
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({}, "ps_somekey"))
    expect(res.status).toBe(400)
  })

  it("returns 401 when api key is invalid", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: false })
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_badkey"))
    expect(res.status).toBe(401)
    expect(mockWriteLog).toHaveBeenCalledWith(
      "permission_denied", "warn", "invalid api key", { orgId: "org-1" }
    )
  })

  it("returns 429 with Retry-After header when within cooldown", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true, cooldownRemaining: 45 })
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("45")
    expect(mockWriteLog).toHaveBeenCalledWith(
      "permission_denied", "warn", "api crawl rate limited", { orgId: "org-1" }
    )
  })

  it("returns 404 when org not found", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true })
    mockGetOrg.mockResolvedValue(null)
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(404)
  })

  it("returns 422 when org has no storage locations", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true })
    mockGetOrg.mockResolvedValue({ orgId: "org-1", name: "Org One" })
    mockListStorageLocations.mockResolvedValue([])
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(422)
  })

  it("returns 202 with locationCount and triggers crawl fire-and-forget", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true })
    mockGetOrg.mockResolvedValue({ orgId: "org-1", name: "Org One" })
    const loc1 = { storageLocationId: "loc-1", orgId: "org-1" }
    const loc2 = { storageLocationId: "loc-2", orgId: "org-1" }
    mockListStorageLocations.mockResolvedValue([loc1, loc2])
    mockRecordTrigger.mockResolvedValue(undefined)
    mockRunCrawl.mockResolvedValue({ added: 1, updated: 0, stale: 0, unchanged: 0 })
    const { POST } = await import("@/app/api/integrations/crawl/route")
    const res = await POST(makeReq({ orgId: "org-1" }, "ps_key"))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ orgId: "org-1", locationCount: 2 })
    expect(mockRecordTrigger).toHaveBeenCalledWith("org-1")
    expect(mockWriteLog).toHaveBeenCalledWith(
      "crawl", "info", "api-triggered crawl started", { orgId: "org-1", locationCount: 2 }
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/app/api/integrations/crawl.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/integrations/crawl/route'`

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/integrations/crawl/route.ts
import { NextResponse } from "next/server"
import { validateApiKey, recordTrigger } from "@/lib/identity/api-keys"
import { getOrg } from "@/lib/identity/orgs"
import { listStorageLocations } from "@/lib/storage/locations"
import { runCrawl } from "@/lib/storage/crawl"
import { writeLog } from "@/lib/logging"

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const rawKey = authHeader.slice(7)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("orgId" in body) ||
    typeof (body as { orgId: unknown }).orgId !== "string"
  ) {
    return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
  }
  const orgId = (body as { orgId: string }).orgId

  const validation = await validateApiKey(orgId, rawKey)
  if (!validation.valid) {
    writeLog("permission_denied", "warn", "invalid api key", { orgId })
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (validation.cooldownRemaining !== undefined) {
    writeLog("permission_denied", "warn", "api crawl rate limited", { orgId })
    return new NextResponse(JSON.stringify({ error: "Too Many Requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(validation.cooldownRemaining),
      },
    })
  }

  const org = await getOrg(orgId)
  if (!org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 })
  }

  const locations = await listStorageLocations(orgId)
  if (locations.length === 0) {
    return NextResponse.json({ error: "No storage locations configured" }, { status: 422 })
  }

  await recordTrigger(orgId)
  writeLog("crawl", "info", "api-triggered crawl started", { orgId, locationCount: locations.length })

  void (async () => {
    for (const location of locations) {
      await runCrawl(location)
    }
  })()

  return NextResponse.json({ orgId, locationCount: locations.length }, { status: 202 })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/app/api/integrations/crawl.test.ts
```

Expected: all 8 tests PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
cd /home/tteoh/publicserve && npm test
```

Expected: all tests PASS

- [ ] **Step 6: Type check**

```bash
cd /home/tteoh/publicserve && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd /home/tteoh/publicserve && git add src/app/api/integrations/crawl/route.ts tests/app/api/integrations/crawl.test.ts
git commit -m "feat: add bearer-authed crawl trigger endpoint with 60s cooldown"
```
