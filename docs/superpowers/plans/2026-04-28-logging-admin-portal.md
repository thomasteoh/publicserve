# Logging & Admin Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured audit logging across all platform operations and expose a full admin portal with a log viewer and dashboard.

**Architecture:** A fire-and-forget `writeLog()` helper writes to an `AuditLogs` Azure Table with composite partition keys (`{category}#{YYYYMMDD}`) and reverse-tick row keys for newest-first ordering. A shared `queryLogs()` function is used both by a thin API route (for client-side "Load more") and directly by the server-rendered logs page. The admin portal is gated by a layout-level auth check that verifies `FULL_ACCESS` permissions.

**Tech Stack:** `@azure/data-tables`, Next.js 15 App Router (async searchParams), React 19 (server + client components), next-auth v5, Vitest

---

## File Map

**New files:**
- `src/lib/logging.ts` — `writeLog()` fire-and-forget helper
- `src/lib/admin-logs.ts` — `queryLogs()` shared query function
- `src/types/logging.ts` — `LogEntry` interface
- `src/app/api/admin/logs/route.ts` — thin `GET /api/admin/logs` route (auth + queryLogs)
- `src/app/admin/layout.tsx` — auth gate + sidebar nav
- `src/app/admin/page.tsx` — dashboard stub
- `src/app/admin/logs/page.tsx` — log viewer server component
- `src/app/admin/logs/LogViewer.tsx` — client component (table + "Load more")
- `tests/lib/logging.test.ts`
- `tests/lib/admin-logs.test.ts`
- `tests/app/api/admin/logs.test.ts`

**Modified files:**
- `src/auth.ts` — add `sendVerificationRequest` override + `signIn` event with `writeLog`
- `src/lib/storage/crawl.ts` — emit crawl/storage_error logs
- `src/lib/keyvault.ts` — emit storage_error log on failure
- `src/app/api/orgs/[orgId]/storage-locations/[locationId]/crawl/route.ts` — emit permission_denied
- `src/app/api/records/[locationId]/[recordRK]/serve/route.ts` — emit serve + permission_denied + storage_error
- `tests/lib/crawl.test.ts` — add `vi.mock('@/lib/logging')`
- `tests/lib/keyvault.test.ts` — add `vi.mock('@/lib/logging')`

---

### Task 1: `writeLog()` helper

**Files:**
- Create: `src/lib/logging.ts`
- Create: `tests/lib/logging.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/logging.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/lib/logging.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/logging'`

- [ ] **Step 3: Implement `writeLog()`**

```typescript
// src/lib/logging.ts
import { getTableClient } from "@/lib/azure-tables"

export type LogCategory =
  | "auth"
  | "crawl"
  | "serve"
  | "permission_denied"
  | "storage_error"

export type LogLevel = "info" | "warn" | "error"

export interface LogMetadata {
  userId?: string
  orgId?: string
  [key: string]: unknown
}

export function writeLog(
  category: LogCategory,
  level: LogLevel,
  message: string,
  metadata?: LogMetadata
): void {
  void (async () => {
    try {
      const now = new Date()
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, "")
      const partitionKey = `${category}#${datePart}`
      const reverseMs = (Number.MAX_SAFE_INTEGER - now.getTime())
        .toString()
        .padStart(16, "0")
      const rowKey = `${reverseMs}-${Math.random().toString(36).slice(2, 6)}`

      const { userId, orgId, ...rest } = metadata ?? {}
      const entity: Record<string, unknown> = {
        partitionKey,
        rowKey,
        category,
        level,
        message,
        timestamp: now.toISOString(),
      }
      if (userId !== undefined) entity.userId = userId
      if (orgId !== undefined) entity.orgId = orgId
      if (Object.keys(rest).length > 0) entity.metadata = JSON.stringify(rest)

      const client = getTableClient("AuditLogs")
      await client.createEntity(entity)
    } catch (err) {
      console.error("[writeLog] failed to write audit log:", err)
    }
  })()
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/lib/logging.test.ts
```

Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
cd /home/tteoh/publicserve && git add src/lib/logging.ts tests/lib/logging.test.ts && git commit -m "feat: add writeLog fire-and-forget audit log helper"
```

---

### Task 2: `LogEntry` type + `queryLogs()` helper

**Files:**
- Create: `src/types/logging.ts`
- Create: `src/lib/admin-logs.ts`
- Create: `tests/lib/admin-logs.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
    await queryLogs({
      category: "auth",
      from: "2026-04-28",
      to: "2026-04-28",
      cursor: "9007199250000000-abcd",
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

  it("stops at 50 entries and returns nextCursor", async () => {
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
    expect(result.nextCursor).toBe("00049")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/lib/admin-logs.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/admin-logs'`

- [ ] **Step 3: Create `LogEntry` type**

```typescript
// src/types/logging.ts
import type { LogCategory } from "@/lib/logging"

export interface LogEntry {
  rowKey: string
  category: LogCategory
  level: string
  message: string
  timestamp: string
  userId?: string
  orgId?: string
  metadata?: string
}
```

- [ ] **Step 4: Implement `queryLogs()`**

```typescript
// src/lib/admin-logs.ts
import { getTableClient } from "@/lib/azure-tables"
import type { LogCategory } from "@/lib/logging"
import type { LogEntry } from "@/types/logging"

const ALL_CATEGORIES: LogCategory[] = [
  "auth",
  "crawl",
  "serve",
  "permission_denied",
  "storage_error",
]

const PAGE_SIZE = 50

function dateRange(
  from: string | null | undefined,
  to: string | null | undefined
): string[] {
  const startDate = from
    ? new Date(from)
    : (() => {
        const d = new Date()
        d.setDate(d.getDate() - 6)
        return d
      })()
  const endDate = to ? new Date(to) : new Date()
  const dates: string[] = []
  const cur = new Date(endDate)
  while (cur >= startDate) {
    dates.push(cur.toISOString().slice(0, 10).replace(/-/g, ""))
    cur.setDate(cur.getDate() - 1)
  }
  return dates
}

export interface QueryLogsParams {
  category?: string | null
  from?: string | null
  to?: string | null
  cursor?: string | null
}

export interface QueryLogsResult {
  entries: LogEntry[]
  nextCursor: string | null
}

export async function queryLogs(
  params: QueryLogsParams
): Promise<QueryLogsResult> {
  const { category, from, to, cursor } = params
  const categories = category
    ? [category as LogCategory]
    : ALL_CATEGORIES
  const dates = dateRange(from, to)
  const client = getTableClient("AuditLogs")
  const entries: LogEntry[] = []

  outer: for (const date of dates) {
    for (const cat of categories) {
      const partitionKey = `${cat}#${date}`
      let filter = `PartitionKey eq '${partitionKey}'`
      if (cursor) filter += ` and RowKey gt '${cursor}'`

      for await (const entity of client.listEntities<Record<string, unknown>>({
        queryOptions: { filter },
      })) {
        entries.push({
          rowKey: entity.rowKey as string,
          category: entity.category as LogCategory,
          level: entity.level as string,
          message: entity.message as string,
          timestamp: entity.timestamp as string,
          userId: entity.userId as string | undefined,
          orgId: entity.orgId as string | undefined,
          metadata: entity.metadata as string | undefined,
        })
        if (entries.length >= PAGE_SIZE) break outer
      }
    }
  }

  const nextCursor =
    entries.length === PAGE_SIZE ? entries[entries.length - 1].rowKey : null
  return { entries, nextCursor }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/lib/admin-logs.test.ts
```

Expected: PASS — 4 tests pass

- [ ] **Step 6: Commit**

```bash
cd /home/tteoh/publicserve && git add src/types/logging.ts src/lib/admin-logs.ts tests/lib/admin-logs.test.ts && git commit -m "feat: add LogEntry type and queryLogs helper"
```

---

### Task 3: `GET /api/admin/logs` route

**Files:**
- Create: `src/app/api/admin/logs/route.ts`
- Create: `tests/app/api/admin/logs.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/app/api/admin/logs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/auth")
vi.mock("@/lib/permissions")
vi.mock("@/lib/admin-logs")

import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { queryLogs } from "@/lib/admin-logs"

const FULL_ACCESS = {
  isAdmin: true,
  canRead: true,
  canWrite: true,
  canManageUsers: true,
  canConfigureIntegrations: true,
}
const NO_ACCESS = {
  isAdmin: false,
  canRead: false,
  canWrite: false,
  canManageUsers: false,
  canConfigureIntegrations: false,
}

describe("GET /api/admin/logs", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const { GET } = await import("@/app/api/admin/logs/route")
    const res = await GET(new Request("http://localhost/api/admin/logs"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when authenticated but not admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never)
    vi.mocked(resolvePermissions).mockResolvedValue(NO_ACCESS)
    const { GET } = await import("@/app/api/admin/logs/route")
    const res = await GET(new Request("http://localhost/api/admin/logs"))
    expect(res.status).toBe(403)
  })

  it("returns 200 with query results for admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never)
    vi.mocked(resolvePermissions).mockResolvedValue(FULL_ACCESS)
    vi.mocked(queryLogs).mockResolvedValue({ entries: [], nextCursor: null })
    const { GET } = await import("@/app/api/admin/logs/route")
    const res = await GET(new Request("http://localhost/api/admin/logs"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entries: [], nextCursor: null })
  })

  it("passes all query params to queryLogs", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never)
    vi.mocked(resolvePermissions).mockResolvedValue(FULL_ACCESS)
    vi.mocked(queryLogs).mockResolvedValue({ entries: [], nextCursor: null })
    const { GET } = await import("@/app/api/admin/logs/route")
    await GET(
      new Request(
        "http://localhost/api/admin/logs?category=crawl&from=2026-04-01&to=2026-04-28&cursor=abc"
      )
    )
    expect(queryLogs).toHaveBeenCalledWith({
      category: "crawl",
      from: "2026-04-01",
      to: "2026-04-28",
      cursor: "abc",
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/app/api/admin/logs.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/admin/logs/route'`

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/admin/logs/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { queryLogs } from "@/lib/admin-logs"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const perms = await resolvePermissions(session.user.id)
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const result = await queryLogs({
    category: url.searchParams.get("category"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    cursor: url.searchParams.get("cursor"),
  })

  return NextResponse.json(result)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/tteoh/publicserve && npx vitest run tests/app/api/admin/logs.test.ts
```

Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
cd /home/tteoh/publicserve && git add src/app/api/admin/logs/route.ts tests/app/api/admin/logs.test.ts && git commit -m "feat: add GET /api/admin/logs route"
```

---

### Task 4: Emit auth logs in `src/auth.ts`

**Files:**
- Modify: `src/auth.ts`

No new tests — next-auth config is not unit-tested in this codebase.

- [ ] **Step 1: Update `src/auth.ts`**

Replace the entire file with:

```typescript
// src/auth.ts
import NextAuth from "next-auth"
import Nodemailer from "next-auth/providers/nodemailer"
import nodemailer from "nodemailer"
import { AzureTablesAdapter } from "@/lib/auth/adapter"
import { bootstrapFirstAdmin } from "@/lib/identity/bootstrap"
import { writeLog } from "@/lib/logging"

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: AzureTablesAdapter(),
  session: { strategy: "database" },
  providers: [
    Nodemailer({
      server: {
        host: process.env.SMTP_HOST!,
        port: Number(process.env.SMTP_PORT ?? 587),
        auth: {
          user: process.env.SMTP_USER!,
          pass: process.env.SMTP_PASSWORD!,
        },
      },
      from: process.env.SMTP_FROM!,
      async sendVerificationRequest({ identifier, url, provider: emailProvider }) {
        const { host } = new URL(url)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transport = nodemailer.createTransport(emailProvider.server as any)
        await transport.sendMail({
          to: identifier,
          from: emailProvider.from,
          subject: `Sign in to ${host}`,
          text: `Sign in to ${host}\n\n${url}\n\n`,
          html: `<p>Sign in to <strong>${host}</strong></p><p><a href="${url}">Sign in</a></p>`,
        })
        writeLog("auth", "info", "verification email sent", { email: identifier })
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
  events: {
    async signIn({ user }) {
      writeLog("auth", "info", "user signed in", {
        userId: user.id ?? undefined,
      })
    },
    async createUser({ user }) {
      writeLog("auth", "info", "new user created", {
        userId: user.id ?? undefined,
      })
      if (user.id) await bootstrapFirstAdmin(user.id)
    },
  },
})
```

- [ ] **Step 2: Run all unit tests to confirm no regressions**

```bash
cd /home/tteoh/publicserve && npx vitest run
```

Expected: all existing tests pass

- [ ] **Step 3: Commit**

```bash
cd /home/tteoh/publicserve && git add src/auth.ts && git commit -m "feat: emit auth audit logs (sign-in, create-user, verification email)"
```

---

### Task 5: Emit crawl + keyvault logs, update existing tests

**Files:**
- Modify: `src/lib/storage/crawl.ts`
- Modify: `src/lib/keyvault.ts`
- Modify: `tests/lib/crawl.test.ts`
- Modify: `tests/lib/keyvault.test.ts`

- [ ] **Step 1: Add `vi.mock('@/lib/logging')` to crawl test**

Open `tests/lib/crawl.test.ts`. Add this line immediately after the existing `vi.mock` calls at the top of the file (after line 3, before any imports):

```typescript
vi.mock("@/lib/logging", () => ({ writeLog: vi.fn() }))
```

The file top should look like:

```typescript
// tests/lib/crawl.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "crypto"

vi.mock("@/lib/logging", () => ({ writeLog: vi.fn() }))

vi.mock("@/lib/storage/records", () => ({
  // ... (existing mock unchanged)
```

- [ ] **Step 2: Add `vi.mock('@/lib/logging')` to keyvault test**

Open `tests/lib/keyvault.test.ts`. Add this line after the existing `vi.mock` calls (after the `vi.mock("@azure/identity", ...)` block, before `describe`):

```typescript
vi.mock("@/lib/logging", () => ({ writeLog: vi.fn() }))
```

- [ ] **Step 3: Update `src/lib/storage/crawl.ts`**

Replace the entire file with:

```typescript
// src/lib/storage/crawl.ts
import { getSecret } from "@/lib/keyvault"
import { createBackend } from "@/lib/storage/factory"
import { upsertRecord, markStaleRecords } from "@/lib/storage/records"
import { writeLog } from "@/lib/logging"
import type { StorageCredential, StorageLocation } from "@/lib/storage/types"

export interface CrawlResult {
  added: number
  updated: number
  stale: number
  unchanged: number
}

export async function runCrawl(location: StorageLocation): Promise<CrawlResult> {
  writeLog("crawl", "info", "crawl started", {
    orgId: location.orgId,
    locationId: location.storageLocationId,
  })

  try {
    const creds = await getSecret<StorageCredential>(location.credentialRef)
    const backend = createBackend(location, creds)

    const seenPaths = new Set<string>()
    let added = 0
    const updated = 0

    for await (const entry of backend.list(location.rootPath)) {
      if (!entry.path.endsWith(".html")) continue
      seenPaths.add(entry.path)
      await upsertRecord(location.storageLocationId, location.orgId, entry, undefined)
      added++
    }

    const stale = await markStaleRecords(location.storageLocationId, seenPaths)
    const result: CrawlResult = { added, updated, stale, unchanged: 0 }

    writeLog("crawl", "info", "crawl completed", {
      orgId: location.orgId,
      locationId: location.storageLocationId,
      added: result.added,
      updated: result.updated,
      stale: result.stale,
      unchanged: result.unchanged,
    })

    return result
  } catch (err) {
    writeLog("crawl", "error", "crawl error", {
      orgId: location.orgId,
      locationId: location.storageLocationId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
```

- [ ] **Step 4: Update `src/lib/keyvault.ts`**

Replace the entire file with:

```typescript
// src/lib/keyvault.ts
import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"
import { writeLog } from "@/lib/logging"

let _client: SecretClient | null = null

function getClient(): SecretClient {
  if (_client) return _client
  const uri = process.env.AZURE_KEYVAULT_URI
  if (!uri) throw new Error("AZURE_KEYVAULT_URI is not set")
  _client = new SecretClient(uri, new DefaultAzureCredential())
  return _client
}

export async function getSecret<T = unknown>(secretName: string): Promise<T> {
  try {
    const client = getClient()
    const secret = await client.getSecret(secretName)
    if (!secret.value) throw new Error(`Secret ${secretName} has no value`)
    return JSON.parse(secret.value) as T
  } catch (err) {
    writeLog("storage_error", "error", "keyvault error", {
      secretName,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function setSecret(secretName: string, value: unknown): Promise<void> {
  const client = getClient()
  await client.setSecret(secretName, JSON.stringify(value))
}
```

- [ ] **Step 5: Run all unit tests**

```bash
cd /home/tteoh/publicserve && npx vitest run
```

Expected: all tests pass (crawl + keyvault tests pass because writeLog is mocked)

- [ ] **Step 6: Commit**

```bash
cd /home/tteoh/publicserve && git add src/lib/storage/crawl.ts src/lib/keyvault.ts tests/lib/crawl.test.ts tests/lib/keyvault.test.ts && git commit -m "feat: emit crawl and keyvault audit logs"
```

---

### Task 6: Emit route handler logs

**Files:**
- Modify: `src/app/api/orgs/[orgId]/storage-locations/[locationId]/crawl/route.ts`
- Modify: `src/app/api/records/[locationId]/[recordRK]/serve/route.ts`

No new tests — route handlers are not unit-tested in this codebase.

- [ ] **Step 1: Update the crawl route handler**

Replace the entire file with:

```typescript
// src/app/api/orgs/[orgId]/storage-locations/[locationId]/crawl/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { getStorageLocation } from "@/lib/storage/locations"
import { runCrawl } from "@/lib/storage/crawl"
import { writeLog } from "@/lib/logging"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; locationId: string }> }
) {
  const { orgId, locationId } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    writeLog("permission_denied", "warn", "permission denied: crawl", {
      userId: session.user.id,
      orgId,
      locationId,
    })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const location = await getStorageLocation(orgId, locationId)
  if (!location) {
    return NextResponse.json({ error: "Storage location not found" }, { status: 404 })
  }

  const result = await runCrawl(location)
  return NextResponse.json(result)
}
```

- [ ] **Step 2: Update the serve route handler**

Replace the entire file with:

```typescript
// src/app/api/records/[locationId]/[recordRK]/serve/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { getRecord } from "@/lib/storage/records"
import { getStorageLocation } from "@/lib/storage/locations"
import { getSecret } from "@/lib/keyvault"
import { createBackend } from "@/lib/storage/factory"
import { writeLog } from "@/lib/logging"
import type { StorageCredential } from "@/lib/storage/types"
import { Readable } from "stream"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locationId: string; recordRK: string }> }
) {
  const { locationId, recordRK } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const record = await getRecord(locationId, recordRK)
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const perms = await resolvePermissions(session.user.id, record.orgId)
  if (!perms.isAdmin && !perms.canRead) {
    writeLog("permission_denied", "warn", "permission denied: serve", {
      userId: session.user.id,
      locationId,
      recordRK,
    })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const location = await getStorageLocation(record.orgId, locationId)
  if (!location) {
    return NextResponse.json({ error: "Storage location not found" }, { status: 404 })
  }

  try {
    const creds = await getSecret<StorageCredential>(location.credentialRef)
    const backend = createBackend(location, creds)
    const signedUrl = await backend.getSignedUrl(record.path, 300)

    if (signedUrl !== null) {
      writeLog("serve", "info", "record served via redirect", {
        userId: session.user.id,
        orgId: record.orgId,
        locationId,
        recordRK,
      })
      return NextResponse.redirect(signedUrl, 302)
    }

    writeLog("serve", "info", "record served via sftp proxy", {
      userId: session.user.id,
      orgId: record.orgId,
      locationId,
      recordRK,
    })
    const stream = await backend.readStream(record.path)
    const webStream = Readable.toWeb(stream as Readable) as ReadableStream
    return new Response(webStream, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (err) {
    writeLog("storage_error", "error", "storage error during serve", {
      userId: session.user.id,
      locationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Storage error" }, { status: 500 })
  }
}
```

- [ ] **Step 3: Run all unit tests**

```bash
cd /home/tteoh/publicserve && npx vitest run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
cd /home/tteoh/publicserve && git add src/app/api/orgs/[orgId]/storage-locations/[locationId]/crawl/route.ts src/app/api/records/[locationId]/[recordRK]/serve/route.ts && git commit -m "feat: emit permission_denied and serve audit logs in route handlers"
```

---

### Task 7: Admin layout + dashboard stub

**Files:**
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`

No tests — server component auth gate depends on next-auth session which is not unit-testable.

- [ ] **Step 1: Create admin layout**

```typescript
// src/app/admin/layout.tsx
import { redirect } from "next/navigation"
import Link from "next/link"
import type { ReactNode } from "react"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin")
  }

  const perms = await resolvePermissions(session.user.id)
  if (!perms.isAdmin) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>403 Forbidden</h1>
        <p>You do not have admin access.</p>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav
        style={{
          width: 200,
          padding: "1rem",
          borderRight: "1px solid #ccc",
          flexShrink: 0,
        }}
      >
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li style={{ marginBottom: "0.5rem" }}>
            <Link href="/admin">Dashboard</Link>
          </li>
          <li>
            <Link href="/admin/logs">Logs</Link>
          </li>
        </ul>
      </nav>
      <main style={{ flex: 1, padding: "1rem" }}>{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Create dashboard stub**

```typescript
// src/app/admin/page.tsx
export default function AdminDashboard() {
  return (
    <div>
      <h1>Admin Dashboard</h1>
      <p>Platform statistics coming soon.</p>
    </div>
  )
}
```

- [ ] **Step 3: Run all unit tests**

```bash
cd /home/tteoh/publicserve && npx vitest run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
cd /home/tteoh/publicserve && git add src/app/admin/layout.tsx src/app/admin/page.tsx && git commit -m "feat: add admin layout with auth gate and dashboard stub"
```

---

### Task 8: Admin logs page + LogViewer client component

**Files:**
- Create: `src/app/admin/logs/page.tsx`
- Create: `src/app/admin/logs/LogViewer.tsx`

- [ ] **Step 1: Create the LogViewer client component**

```typescript
// src/app/admin/logs/LogViewer.tsx
"use client"

import { Fragment, useState } from "react"
import type { LogEntry } from "@/types/logging"

interface Props {
  initialEntries: LogEntry[]
  initialNextCursor: string | null
  category?: string
  from?: string
  to?: string
}

export default function LogViewer({
  initialEntries,
  initialNextCursor,
  category,
  from,
  to,
}: Props) {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  async function loadMore() {
    if (!nextCursor) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (category) qs.set("category", category)
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    qs.set("cursor", nextCursor)
    const res = await fetch(`/api/admin/logs?${qs}`)
    const data: { entries: LogEntry[]; nextCursor: string | null } =
      await res.json()
    setEntries((prev) => [...prev, ...data.entries])
    setNextCursor(data.nextCursor)
    setLoading(false)
  }

  function toggleRow(rowKey: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Timestamp</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Category</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Level</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Message</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>User</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Org</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.rowKey}>
              <tr style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
                <td style={{ padding: "0.5rem" }}>{entry.category}</td>
                <td style={{ padding: "0.5rem" }}>{entry.level}</td>
                <td style={{ padding: "0.5rem" }}>{entry.message}</td>
                <td style={{ padding: "0.5rem" }}>{entry.userId ?? ""}</td>
                <td style={{ padding: "0.5rem" }}>{entry.orgId ?? ""}</td>
                <td style={{ padding: "0.5rem" }}>
                  {entry.metadata && (
                    <button onClick={() => toggleRow(entry.rowKey)}>
                      {expandedRows.has(entry.rowKey) ? "Hide" : "Show"}
                    </button>
                  )}
                </td>
              </tr>
              {expandedRows.has(entry.rowKey) && entry.metadata && (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: "0.5rem", background: "#f9f9f9" }}
                  >
                    <pre style={{ margin: 0, fontSize: "0.85em" }}>
                      {JSON.stringify(JSON.parse(entry.metadata), null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {nextCursor && (
        <button
          onClick={loadMore}
          disabled={loading}
          style={{ marginTop: "1rem" }}
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the logs page server component**

```typescript
// src/app/admin/logs/page.tsx
import { queryLogs } from "@/lib/admin-logs"
import LogViewer from "./LogViewer"
import type { LogCategory } from "@/lib/logging"

const CATEGORIES: LogCategory[] = [
  "auth",
  "crawl",
  "serve",
  "permission_denied",
  "storage_error",
]

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string
    from?: string
    to?: string
  }>
}) {
  const params = await searchParams
  const { entries, nextCursor } = await queryLogs({
    category: params.category,
    from: params.from,
    to: params.to,
  })

  return (
    <div>
      <h1>Logs</h1>
      <form method="GET" action="/admin/logs" style={{ marginBottom: "1rem" }}>
        <label style={{ marginRight: "1rem" }}>
          Category:{" "}
          <select name="category" defaultValue={params.category ?? ""}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ marginRight: "1rem" }}>
          From:{" "}
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
          />
        </label>
        <label style={{ marginRight: "1rem" }}>
          To:{" "}
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
          />
        </label>
        <button type="submit">Filter</button>
      </form>
      <LogViewer
        initialEntries={entries}
        initialNextCursor={nextCursor}
        category={params.category}
        from={params.from}
        to={params.to}
      />
    </div>
  )
}
```

- [ ] **Step 3: Run all unit tests**

```bash
cd /home/tteoh/publicserve && npx vitest run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
cd /home/tteoh/publicserve && git add src/app/admin/logs/page.tsx src/app/admin/logs/LogViewer.tsx && git commit -m "feat: add admin logs page with server-rendered filter form and client-side pagination"
```

---

### Task 9: Type-check

**Files:** none (verification only)

- [ ] **Step 1: Run TypeScript type-checker**

```bash
cd /home/tteoh/publicserve && npx tsc --noEmit
```

Expected: zero errors

- [ ] **Step 2: If errors, fix them**

Common fixes needed:
- If `entity.rowKey` is typed as `string | undefined` — add `?? ""` or cast to `string` with a non-null assertion.
- If `emailProvider.server` causes a type error — the `as any` cast on the `nodemailer.createTransport` call handles it; if tsc still complains, add `// @ts-expect-error` on that line.
- If `LogEntry` fields have `unknown` instead of `string` from listEntities — the `as string` casts in `queryLogs` handle this.

- [ ] **Step 3: Commit if fixes were needed**

```bash
cd /home/tteoh/publicserve && git add -p && git commit -m "fix: resolve TypeScript errors in logging and admin portal"
```

If no errors, no commit needed.
