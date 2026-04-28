# Phase 2: Auth & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Next.js app with next-auth (magic link via SMTP), a custom Azure Tables adapter, app-level identity tables (Groups, UserGroups, Orgs, OrgGroups), and middleware-based permission resolution.

**Architecture:** next-auth v5 with `strategy: "database"`, custom adapter built on `@azure/data-tables`. Auth tables and app identity tables share one storage account but are cleanly separated. Permission resolution runs in Next.js middleware. First registered user is auto-elevated to admin group.

**Tech Stack:** Next.js 14+ (App Router), next-auth v5 (`next-auth@beta`), `@azure/data-tables`, `@azure/identity`, Vitest, `nodemailer`

---

## File Structure

```
src/
  auth.ts                          # NextAuth config: Email provider, adapter, callbacks
  middleware.ts                    # Next.js edge middleware: session check + permission gate
  lib/
    azure-tables.ts                # TableServiceClient factory (connection string or managed identity)
    auth/
      adapter.ts                   # Custom next-auth adapter implementing AdapterInterface
      tables.ts                    # Low-level table helpers: upsert, get, delete, list
    identity/
      groups.ts                    # Groups table operations
      user-groups.ts               # UserGroups table operations
      orgs.ts                      # Orgs table operations
      org-groups.ts                # OrgGroups table operations
      bootstrap.ts                 # Seed admin group + elevate first user
    permissions.ts                 # resolvePermissions(userId, orgId?) → EffectivePermissions
  types/
    identity.ts                    # Group, UserGroup, Org, OrgGroup, EffectivePermissions types
src/app/
  api/
    auth/
      [...nextauth]/
        route.ts                   # GET/POST handlers (next-auth v5 pattern)
tests/
  lib/
    auth/
      adapter.test.ts              # Unit tests for auth adapter methods
    identity/
      groups.test.ts
      user-groups.test.ts
      orgs.test.ts
      org-groups.test.ts
      bootstrap.test.ts
    permissions.test.ts
vitest.config.ts
.env.local                         # AZURE_TABLES_CONNECTION_STRING, SMTP_*, AUTH_SECRET
```

---

## Task 1: Scaffold Next.js App

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`

- [ ] **Step 1: Create Next.js app**

```bash
cd /home/tteoh/publicserve
npx create-next-app@latest . --typescript --eslint --app --src-dir --import-alias "@/*" --no-tailwind
```

Answer prompts: use App Router = yes.

- [ ] **Step 2: Install auth and Azure dependencies**

```bash
npm install next-auth@beta @azure/data-tables @azure/identity nodemailer
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @types/nodemailer
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

- [ ] **Step 4: Create tests/setup.ts**

```ts
// tests/setup.ts
import "@testing-library/jest-dom"
```

- [ ] **Step 5: Add test script to package.json**

Open `package.json` and add to the `scripts` section:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Create .env.local**

```bash
cat > .env.local << 'EOF'
# Azure Tables (from Phase 1 terraform output storage_connection_string)
AZURE_TABLES_CONNECTION_STRING=

# next-auth
AUTH_SECRET=   # generate with: openssl rand -base64 32
AUTH_URL=http://localhost:3000

# SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@example.com
EOF
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): scaffold Next.js app with vitest and auth dependencies"
```

---

## Task 2: Azure Tables Connection Factory

**Files:**
- Create: `src/lib/azure-tables.ts`
- Create: `src/types/identity.ts`

- [ ] **Step 1: Write failing test for azure-tables factory**

```ts
// tests/lib/azure-tables.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@azure/data-tables", () => ({
  TableServiceClient: {
    fromConnectionString: vi.fn(() => ({ name: "mock-service" })),
  },
}))

describe("getTableServiceClient", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns a TableServiceClient from connection string", async () => {
    process.env.AZURE_TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true"
    const { getTableServiceClient } = await import("@/lib/azure-tables")
    const client = getTableServiceClient()
    expect(client).toBeDefined()
  })

  it("throws when connection string is missing", async () => {
    delete process.env.AZURE_TABLES_CONNECTION_STRING
    vi.resetModules()
    await expect(
      import("@/lib/azure-tables").then((m) => m.getTableServiceClient())
    ).rejects.toThrow("AZURE_TABLES_CONNECTION_STRING")
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/lib/azure-tables.test.ts
```

Expected: FAIL — `@/lib/azure-tables` not found.

- [ ] **Step 3: Implement azure-tables.ts**

```ts
// src/lib/azure-tables.ts
import { TableServiceClient, TableClient } from "@azure/data-tables"

let _client: TableServiceClient | null = null

export function getTableServiceClient(): TableServiceClient {
  if (_client) return _client
  const connStr = process.env.AZURE_TABLES_CONNECTION_STRING
  if (!connStr) throw new Error("AZURE_TABLES_CONNECTION_STRING is not set")
  _client = TableServiceClient.fromConnectionString(connStr)
  return _client
}

export function getTableClient(tableName: string): TableClient {
  const connStr = process.env.AZURE_TABLES_CONNECTION_STRING
  if (!connStr) throw new Error("AZURE_TABLES_CONNECTION_STRING is not set")
  return TableClient.fromConnectionString(connStr, tableName)
}
```

- [ ] **Step 4: Create src/types/identity.ts**

```ts
// src/types/identity.ts
export interface Group {
  groupId: string
  name: string
  isAdmin: boolean
  createdAt: string
  createdBy: string
}

export interface UserGroup {
  userId: string
  groupId: string
  addedAt: string
  addedBy: string
}

export interface Org {
  orgId: string
  name: string
  createdAt: string
  createdBy: string
}

export interface OrgGroup {
  orgId: string
  groupId: string
  canRead: boolean
  canWrite: boolean
  canManageUsers: boolean
  canConfigureIntegrations: boolean
}

export interface EffectivePermissions {
  isAdmin: boolean
  canRead: boolean
  canWrite: boolean
  canManageUsers: boolean
  canConfigureIntegrations: boolean
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/azure-tables.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/azure-tables.ts src/types/identity.ts tests/lib/azure-tables.test.ts tests/setup.ts vitest.config.ts
git commit -m "feat(auth): add Azure Tables client factory and identity types"
```

---

## Task 3: Auth Adapter — Low-level Table Helpers

**Files:**
- Create: `src/lib/auth/tables.ts`

These helpers wrap `@azure/data-tables` operations used by the adapter.

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/lib/auth/tables.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/lib/auth/tables.ts**

```ts
// src/lib/auth/tables.ts
import { getTableClient } from "@/lib/azure-tables"

export async function tableGet<T extends object>(
  tableName: string,
  partitionKey: string,
  rowKey: string
): Promise<(T & { partitionKey: string; rowKey: string }) | null> {
  try {
    const client = getTableClient(tableName)
    const entity = await client.getEntity<T>(partitionKey, rowKey)
    return entity as T & { partitionKey: string; rowKey: string }
  } catch (err: unknown) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function tableUpsert<T extends { partitionKey: string; rowKey: string }>(
  tableName: string,
  entity: T
): Promise<void> {
  const client = getTableClient(tableName)
  await client.upsertEntity(entity, "Merge")
}

export async function tableDelete(
  tableName: string,
  partitionKey: string,
  rowKey: string
): Promise<void> {
  try {
    const client = getTableClient(tableName)
    await client.deleteEntity(partitionKey, rowKey)
  } catch (err: unknown) {
    if (isNotFound(err)) return
    throw err
  }
}

export async function tableList<T extends object>(
  tableName: string,
  filter: string
): Promise<(T & { partitionKey: string; rowKey: string })[]> {
  const client = getTableClient(tableName)
  const results: (T & { partitionKey: string; rowKey: string })[] = []
  for await (const entity of client.listEntities<T>({ queryOptions: { filter } })) {
    results.push(entity as T & { partitionKey: string; rowKey: string })
  }
  return results
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 404
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/auth/tables.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/tables.ts tests/lib/auth/tables.test.ts
git commit -m "feat(auth): add Azure Tables low-level helpers"
```

---

## Task 4: Custom next-auth Adapter

**Files:**
- Create: `src/lib/auth/adapter.ts`
- Create: `tests/lib/auth/adapter.test.ts`

Implements the next-auth `Adapter` interface using the table helpers from Task 3.

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/lib/auth/adapter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/lib/auth/adapter.ts**

```ts
// src/lib/auth/adapter.ts
import type { Adapter, AdapterUser, AdapterSession, AdapterAccount, VerificationToken } from "next-auth/adapters"
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableDelete, tableList } from "@/lib/auth/tables"

export function AzureTablesAdapter(): Adapter {
  return {
    async createUser(data) {
      const id = randomUUID()
      const entity = {
        partitionKey: "user",
        rowKey: id,
        email: data.email,
        emailVerified: data.emailVerified?.toISOString() ?? null,
        name: data.name ?? null,
        image: data.image ?? null,
        createdAt: new Date().toISOString(),
      }
      await tableUpsert("Users", entity)
      return { id, ...data }
    },

    async getUser(id) {
      const entity = await tableGet("Users", "user", id)
      if (!entity) return null
      return entityToUser(entity)
    },

    async getUserByEmail(email) {
      const results = await tableList<Record<string, unknown>>(
        "Users",
        `PartitionKey eq 'user' and email eq '${email}'`
      )
      if (results.length === 0) return null
      return entityToUser(results[0])
    },

    async getUserByAccount({ providerAccountId, provider }) {
      const pk = `account_${provider}_${providerAccountId}`
      const results = await tableList<{ rowKey: string }>(
        "Accounts",
        `PartitionKey eq '${pk}'`
      )
      if (results.length === 0) return null
      const userId = results[0].rowKey
      return this.getUser!(userId)
    },

    async updateUser(data) {
      const existing = await tableGet<Record<string, unknown>>("Users", "user", data.id)
      if (!existing) throw new Error(`User ${data.id} not found`)
      await tableUpsert("Users", {
        ...existing,
        ...omitUndefined({
          name: data.name,
          image: data.image,
          emailVerified: data.emailVerified?.toISOString() ?? null,
        }),
      })
      return { ...entityToUser(existing), ...data }
    },

    async deleteUser(id) {
      await tableDelete("Users", "user", id)
    },

    async linkAccount(data) {
      const pk = `account_${data.provider}_${data.providerAccountId}`
      await tableUpsert("Accounts", {
        partitionKey: pk,
        rowKey: data.userId,
        type: data.type,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
      })
      return data as AdapterAccount
    },

    async unlinkAccount({ providerAccountId, provider }) {
      const pk = `account_${provider}_${providerAccountId}`
      const results = await tableList<{ rowKey: string }>("Accounts", `PartitionKey eq '${pk}'`)
      for (const r of results) await tableDelete("Accounts", pk, r.rowKey)
    },

    async createSession(data) {
      await tableUpsert("Sessions", {
        partitionKey: "session",
        rowKey: data.sessionToken,
        userId: data.userId,
        expires: data.expires.toISOString(),
      })
      return data
    },

    async getSessionAndUser(sessionToken) {
      const session = await tableGet<{ userId: string; expires: string }>(
        "Sessions", "session", sessionToken
      )
      if (!session) return null
      const user = await this.getUser!(session.userId)
      if (!user) return null
      return {
        session: {
          sessionToken,
          userId: session.userId,
          expires: new Date(session.expires),
        },
        user,
      }
    },

    async updateSession(data) {
      const existing = await tableGet<{ userId: string; expires: string }>(
        "Sessions", "session", data.sessionToken
      )
      if (!existing) return null
      const updated = {
        ...existing,
        expires: (data.expires ?? new Date(existing.expires)).toISOString(),
      }
      await tableUpsert("Sessions", updated)
      return { sessionToken: data.sessionToken, userId: existing.userId, expires: new Date(updated.expires) }
    },

    async deleteSession(sessionToken) {
      await tableDelete("Sessions", "session", sessionToken)
    },

    async createVerificationToken(data) {
      await tableUpsert("VerificationTokens", {
        partitionKey: "verificationToken",
        rowKey: `${data.identifier}_${data.token}`,
        expires: data.expires.toISOString(),
      })
      return data
    },

    async useVerificationToken({ identifier, token }) {
      const rk = `${identifier}_${token}`
      const entity = await tableGet<{ expires: string }>("VerificationTokens", "verificationToken", rk)
      if (!entity) return null
      await tableDelete("VerificationTokens", "verificationToken", rk)
      return { identifier, token, expires: new Date(entity.expires) }
    },
  }
}

function entityToUser(entity: Record<string, unknown>): AdapterUser {
  return {
    id: entity.rowKey as string,
    email: entity.email as string,
    emailVerified: entity.emailVerified ? new Date(entity.emailVerified as string) : null,
    name: (entity.name as string | null) ?? null,
    image: (entity.image as string | null) ?? null,
  }
}

function omitUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/auth/adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/adapter.ts tests/lib/auth/adapter.test.ts
git commit -m "feat(auth): add custom Azure Tables next-auth adapter"
```

---

## Task 5: App Identity Operations

**Files:**
- Create: `src/lib/identity/groups.ts`
- Create: `src/lib/identity/user-groups.ts`
- Create: `src/lib/identity/orgs.ts`
- Create: `src/lib/identity/org-groups.ts`
- Create: `src/lib/identity/bootstrap.ts`

- [ ] **Step 1: Write failing tests for groups**

```ts
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
    })
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
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/lib/identity/groups.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement src/lib/identity/groups.ts**

```ts
// src/lib/identity/groups.ts
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { Group } from "@/types/identity"

const TABLE = "Groups"

export async function getGroup(groupId: string): Promise<Group | null> {
  const e = await tableGet<Group>(TABLE, "group", groupId)
  if (!e) return null
  return entityToGroup(e)
}

export async function listGroups(): Promise<Group[]> {
  const rows = await tableList<Group>(TABLE, "PartitionKey eq 'group'")
  return rows.map(entityToGroup)
}

export async function createGroup(
  data: Pick<Group, "name" | "isAdmin" | "createdBy">
): Promise<Group> {
  const groupId = randomUUID()
  const entity = {
    partitionKey: "group",
    rowKey: groupId,
    name: data.name,
    isAdmin: data.isAdmin,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy,
  }
  await tableUpsert(TABLE, entity)
  return { groupId, ...data, createdAt: entity.createdAt }
}

export async function deleteGroup(groupId: string): Promise<void> {
  await tableDelete(TABLE, "group", groupId)
}

export async function getAdminGroups(): Promise<Group[]> {
  const rows = await tableList<Group>(TABLE, "PartitionKey eq 'group' and isAdmin eq true")
  return rows.map(entityToGroup)
}

function entityToGroup(e: Record<string, unknown>): Group {
  return {
    groupId: e.rowKey as string,
    name: e.name as string,
    isAdmin: e.isAdmin as boolean,
    createdAt: e.createdAt as string,
    createdBy: e.createdBy as string,
  }
}
```

- [ ] **Step 4: Run groups test — expect pass**

```bash
npx vitest run tests/lib/identity/groups.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement src/lib/identity/user-groups.ts**

```ts
// src/lib/identity/user-groups.ts
import { tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { UserGroup } from "@/types/identity"

const TABLE = "UserGroups"

export async function addUserToGroup(
  userId: string,
  groupId: string,
  addedBy: string
): Promise<void> {
  await tableUpsert(TABLE, {
    partitionKey: userId,
    rowKey: groupId,
    addedAt: new Date().toISOString(),
    addedBy,
  })
}

export async function removeUserFromGroup(userId: string, groupId: string): Promise<void> {
  await tableDelete(TABLE, userId, groupId)
}

export async function getGroupsForUser(userId: string): Promise<string[]> {
  const rows = await tableList<UserGroup>(TABLE, `PartitionKey eq '${userId}'`)
  return rows.map((r) => r.rowKey as unknown as string)
}

export async function getUsersInGroup(groupId: string): Promise<string[]> {
  // Note: this is a cross-partition scan — acceptable for low-volume admin ops
  const rows = await tableList<UserGroup>(TABLE, `RowKey eq '${groupId}'`)
  return rows.map((r) => r.partitionKey as unknown as string)
}
```

- [ ] **Step 6: Implement src/lib/identity/orgs.ts**

```ts
// src/lib/identity/orgs.ts
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { Org } from "@/types/identity"

const TABLE = "Orgs"

export async function getOrg(orgId: string): Promise<Org | null> {
  const e = await tableGet<Org>(TABLE, "org", orgId)
  if (!e) return null
  return { orgId: e.rowKey as string, name: e.name as string, createdAt: e.createdAt as string, createdBy: e.createdBy as string }
}

export async function listOrgs(): Promise<Org[]> {
  const rows = await tableList<Org>(TABLE, "PartitionKey eq 'org'")
  return rows.map((e) => ({
    orgId: e.rowKey as string,
    name: e.name as string,
    createdAt: e.createdAt as string,
    createdBy: e.createdBy as string,
  }))
}

export async function createOrg(data: Pick<Org, "name" | "createdBy">): Promise<Org> {
  const orgId = randomUUID()
  const entity = {
    partitionKey: "org",
    rowKey: orgId,
    name: data.name,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy,
  }
  await tableUpsert(TABLE, entity)
  return { orgId, ...data, createdAt: entity.createdAt }
}

export async function deleteOrg(orgId: string): Promise<void> {
  await tableDelete(TABLE, "org", orgId)
}
```

- [ ] **Step 7: Implement src/lib/identity/org-groups.ts**

```ts
// src/lib/identity/org-groups.ts
import { tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { OrgGroup } from "@/types/identity"

const TABLE = "OrgGroups"

export async function setOrgGroupPermissions(data: OrgGroup): Promise<void> {
  await tableUpsert(TABLE, {
    partitionKey: data.orgId,
    rowKey: data.groupId,
    canRead: data.canRead,
    canWrite: data.canWrite,
    canManageUsers: data.canManageUsers,
    canConfigureIntegrations: data.canConfigureIntegrations,
  })
}

export async function removeGroupFromOrg(orgId: string, groupId: string): Promise<void> {
  await tableDelete(TABLE, orgId, groupId)
}

export async function getOrgGroups(orgId: string): Promise<OrgGroup[]> {
  const rows = await tableList<OrgGroup>(TABLE, `PartitionKey eq '${orgId}'`)
  return rows.map((e) => ({
    orgId,
    groupId: e.rowKey as unknown as string,
    canRead: e.canRead as boolean,
    canWrite: e.canWrite as boolean,
    canManageUsers: e.canManageUsers as boolean,
    canConfigureIntegrations: e.canConfigureIntegrations as boolean,
  }))
}
```

- [ ] **Step 8: Implement src/lib/identity/bootstrap.ts**

```ts
// src/lib/identity/bootstrap.ts
import { listGroups, createGroup, getAdminGroups } from "@/lib/identity/groups"
import { addUserToGroup, getUsersInGroup } from "@/lib/identity/user-groups"

const ADMIN_GROUP_NAME = "admin"

/** Ensure admin group exists. Returns its groupId. */
export async function ensureAdminGroup(): Promise<string> {
  const adminGroups = await getAdminGroups()
  if (adminGroups.length > 0) return adminGroups[0].groupId
  const group = await createGroup({ name: ADMIN_GROUP_NAME, isAdmin: true, createdBy: "system" })
  return group.groupId
}

/** Called from next-auth createUser event. Elevates user to admin if admin group has no members. */
export async function bootstrapFirstAdmin(userId: string): Promise<void> {
  const adminGroupId = await ensureAdminGroup()
  const members = await getUsersInGroup(adminGroupId)
  if (members.length === 0) {
    await addUserToGroup(userId, adminGroupId, "system")
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/identity/ tests/lib/identity/
git commit -m "feat(auth): add identity table operations and admin bootstrap"
```

---

## Task 6: Permission Resolution

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `tests/lib/permissions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/permissions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/identity/groups", () => ({
  getGroup: vi.fn(),
  getAdminGroups: vi.fn(),
}))
vi.mock("@/lib/identity/user-groups", () => ({
  getGroupsForUser: vi.fn(),
}))
vi.mock("@/lib/identity/org-groups", () => ({
  getOrgGroups: vi.fn(),
}))

import { getGroup, getAdminGroups } from "@/lib/identity/groups"
import { getGroupsForUser } from "@/lib/identity/user-groups"
import { getOrgGroups } from "@/lib/identity/org-groups"

describe("resolvePermissions", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns isAdmin=true when user is in admin group", async () => {
    vi.mocked(getGroupsForUser).mockResolvedValue(["g-admin"])
    vi.mocked(getGroup).mockResolvedValue({
      groupId: "g-admin", name: "admin", isAdmin: true,
      createdAt: "", createdBy: "system",
    })
    const { resolvePermissions } = await import("@/lib/permissions")
    const perms = await resolvePermissions("user-1")
    expect(perms.isAdmin).toBe(true)
    expect(perms.canRead).toBe(true)
  })

  it("returns org permissions for non-admin user", async () => {
    vi.mocked(getGroupsForUser).mockResolvedValue(["g-editors"])
    vi.mocked(getGroup).mockResolvedValue({
      groupId: "g-editors", name: "editors", isAdmin: false,
      createdAt: "", createdBy: "user-1",
    })
    vi.mocked(getOrgGroups).mockResolvedValue([
      {
        orgId: "org-1", groupId: "g-editors",
        canRead: true, canWrite: true, canManageUsers: false, canConfigureIntegrations: false,
      },
    ])
    const { resolvePermissions } = await import("@/lib/permissions")
    const perms = await resolvePermissions("user-1", "org-1")
    expect(perms.isAdmin).toBe(false)
    expect(perms.canRead).toBe(true)
    expect(perms.canWrite).toBe(true)
    expect(perms.canManageUsers).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/lib/permissions.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement src/lib/permissions.ts**

```ts
// src/lib/permissions.ts
import { getGroup } from "@/lib/identity/groups"
import { getGroupsForUser } from "@/lib/identity/user-groups"
import { getOrgGroups } from "@/lib/identity/org-groups"
import type { EffectivePermissions } from "@/types/identity"

const FULL_ACCESS: EffectivePermissions = {
  isAdmin: true,
  canRead: true,
  canWrite: true,
  canManageUsers: true,
  canConfigureIntegrations: true,
}

const NO_ACCESS: EffectivePermissions = {
  isAdmin: false,
  canRead: false,
  canWrite: false,
  canManageUsers: false,
  canConfigureIntegrations: false,
}

export async function resolvePermissions(
  userId: string,
  orgId?: string
): Promise<EffectivePermissions> {
  const groupIds = await getGroupsForUser(userId)
  if (groupIds.length === 0) return NO_ACCESS

  const groups = await Promise.all(groupIds.map((id) => getGroup(id)))
  const isAdmin = groups.some((g) => g?.isAdmin === true)
  if (isAdmin) return FULL_ACCESS

  if (!orgId) return NO_ACCESS

  const orgGroups = await getOrgGroups(orgId)
  const userOrgGroups = orgGroups.filter((og) => groupIds.includes(og.groupId))

  if (userOrgGroups.length === 0) return NO_ACCESS

  return {
    isAdmin: false,
    canRead: userOrgGroups.some((g) => g.canRead),
    canWrite: userOrgGroups.some((g) => g.canWrite),
    canManageUsers: userOrgGroups.some((g) => g.canManageUsers),
    canConfigureIntegrations: userOrgGroups.some((g) => g.canConfigureIntegrations),
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts tests/lib/permissions.test.ts
git commit -m "feat(auth): add permission resolution"
```

---

## Task 7: next-auth Config + API Route

**Files:**
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

> **Note on SMTP secrets:** The spec stores SMTP credentials in Key Vault. Azure SWA app settings support Key Vault reference syntax (`@Microsoft.KeyVault(SecretUri=https://...)`) — set `SMTP_HOST`, `SMTP_PASSWORD` etc. as app settings pointing to KV secrets. The app reads them as plain `process.env.*` at runtime; no code change needed. Configure these in the SWA portal or via Terraform `azurerm_static_web_app` `app_settings` after Phase 1 provisioning.

- [ ] **Step 1: Create src/auth.ts**

```ts
// src/auth.ts
import NextAuth from "next-auth"
import Nodemailer from "next-auth/providers/nodemailer"
import { AzureTablesAdapter } from "@/lib/auth/adapter"
import { bootstrapFirstAdmin } from "@/lib/identity/bootstrap"

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
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) await bootstrapFirstAdmin(user.id)
    },
  },
})
```

- [ ] **Step 2: Create API route**

```ts
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth"
export const { GET, POST } = handlers
```

- [ ] **Step 3: Extend next-auth session types**

Create `src/types/next-auth.d.ts`:

```ts
// src/types/next-auth.d.ts
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/auth.ts src/app/api/ src/types/next-auth.d.ts
git commit -m "feat(auth): wire next-auth config with Azure Tables adapter and SMTP provider"
```

---

## Task 8: Middleware — Session + Permission Gate

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create src/middleware.ts**

```ts
// src/middleware.ts
import { auth } from "@/auth"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export default auth(async (req) => {
  const { pathname } = req.nextUrl

  // Public routes: auth pages, static assets
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/login"
  ) {
    return NextResponse.next()
  }

  // All other routes require a session
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
```

Note: Fine-grained org permission checks are enforced in route handlers using `resolvePermissions()`, not in middleware (middleware runs on the edge and cannot make Table Storage calls in all deployment scenarios).

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): add session-gate middleware"
```

---

## Task 9: Run All Tests

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS. If any fail, fix before proceeding.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(auth): address type errors and test failures"
```
