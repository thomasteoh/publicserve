# Logging & Admin Portal Design

## Goal

Add structured audit logging across all platform operations and expose a full admin portal with a log viewer and dashboard.

---

## Section 1 — Data Model & Log Writer

### Azure Table Storage: `AuditLogs`

| Field | Type | Notes |
|-------|------|-------|
| PartitionKey | string | `{category}#{YYYYMMDD}` e.g. `auth#20260428` |
| RowKey | string | Reverse-tick: `String(Date.now_MAX - Date.now()).padStart(19, '0')` — newest entries sort first within partition |
| category | string | `auth \| crawl \| serve \| permission_denied \| storage_error` |
| level | string | `info \| warn \| error` |
| message | string | Human-readable description |
| timestamp | string | ISO 8601 |
| userId | string? | Present when a user is associated |
| orgId | string? | Present when an org is associated |
| metadata | string? | JSON-serialised arbitrary fields |

**No retention policy.** Logs kept indefinitely.

### `writeLog()` helper

```ts
// src/lib/logging.ts
export type LogCategory = "auth" | "crawl" | "serve" | "permission_denied" | "storage_error";
export type LogLevel = "info" | "warn" | "error";

export function writeLog(
  category: LogCategory,
  level: LogLevel,
  message: string,
  metadata?: {
    userId?: string;
    orgId?: string;
    [key: string]: unknown;
  }
): void
```

- Fire-and-forget (no `await` at call sites).
- Catches its own errors; logs to `console.error` on write failure (never throws).
- PartitionKey computed from UTC date at call time.
- RowKey: `(Number.MAX_SAFE_INTEGER - Date.now()).toString().padStart(16, "0")` — ensures newest-first ordering within a date partition.
- `userId` and `orgId` promoted to top-level entity fields; remaining metadata serialised to `metadata` (JSON string).

---

## Section 2 — Emission Points

### `auth` category

**File:** `src/auth.ts`

| Event | Level | Message |
|-------|-------|---------|
| `sendVerificationRequest` override | `info` | `"verification email sent"` — `{email}` in metadata |
| `events.signIn` | `info` | `"user signed in"` — `{userId}` |
| `events.createUser` | `info` | `"new user created"` — `{userId}` |

### `crawl` category

**File:** `src/lib/storage/crawl.ts`

| Event | Level | Message |
|-------|-------|---------|
| Crawl started | `info` | `"crawl started"` — `{locationId, orgId}` |
| Crawl completed | `info` | `"crawl completed"` — `{locationId, orgId, added, updated, stale, unchanged}` |
| Crawl error (catch block) | `error` | `"crawl error"` — `{locationId, orgId, error: err.message}` |

### `serve` category

**File:** `src/app/api/records/[locationId]/[recordRK]/serve/route.ts`

| Event | Level | Message |
|-------|-------|---------|
| Signed URL redirect issued | `info` | `"record served via redirect"` — `{locationId, recordRK, userId, orgId}` |
| SFTP proxy stream started | `info` | `"record served via sftp proxy"` — `{locationId, recordRK, userId, orgId}` |

### `permission_denied` category

**Files:** crawl route handler, serve route handler

| Event | Level | Message |
|-------|-------|---------|
| 403 from crawl handler | `warn` | `"permission denied: crawl"` — `{userId, orgId, locationId}` |
| 403 from serve handler | `warn` | `"permission denied: serve"` — `{userId, recordRK, locationId}` |

### `storage_error` category

**Files:** `src/lib/storage/crawl.ts`, serve route handler, `src/lib/keyvault.ts`

| Event | Level | Message |
|-------|-------|---------|
| Backend error during crawl | `error` | `"storage error during crawl"` — `{locationId, error: err.message}` |
| Backend error during serve | `error` | `"storage error during serve"` — `{locationId, error: err.message}` |
| Key Vault fetch failure | `error` | `"keyvault error"` — `{secretName, error: err.message}` |

---

## Section 3 — Admin Portal Structure

### Routes

```
src/app/admin/
  layout.tsx         ← auth gate + sidebar nav
  page.tsx           ← dashboard stub
  logs/
    page.tsx         ← log viewer (server component)

src/app/api/admin/
  logs/
    route.ts         ← GET ?category=&from=&to=&cursor=
```

### Admin Auth Gate — `src/app/admin/layout.tsx`

- Server component.
- Calls `auth()` to get session; calls `resolvePermissions(userId)` (no orgId → global check).
- If not authenticated → redirect `/login?callbackUrl=/admin`.
- If authenticated but not `FULL_ACCESS` → render 403 page (not redirect, so URL stays for debugging).
- Renders sidebar nav with links: Dashboard, Logs.

### Dashboard — `src/app/admin/page.tsx`

- Stub only. Heading: "Admin Dashboard". Placeholder text: "Platform statistics coming soon."
- No data fetched at this stage.

### Log Viewer — `src/app/admin/logs/page.tsx`

Server component. Accepts `searchParams`: `category`, `from`, `to`, `cursor`.

**Controls (rendered as a `<form>` with GET action):**
- Category dropdown: All + each of the 5 categories.
- From date input (`<input type="date">`).
- To date input (`<input type="date">`).
- Submit button ("Filter").

**Table columns:** Timestamp | Category | Level | Message | User | Org

**Expandable metadata:** Each row has a toggle to show raw `metadata` JSON in a `<pre>` block below.

**Pagination:** "Load more" button appends `?cursor=<lastRowKey>` — server reads next page via the API route and appends rows. Implemented as a client component island (`"use client"`) wrapping only the Load-more button and the row list; the filter form remains a plain server-rendered form.

### Logs API — `src/app/api/admin/logs/route.ts`

```
GET /api/admin/logs
  ?category=   (optional; omit = all categories)
  ?from=       (optional; YYYY-MM-DD)
  ?to=         (optional; YYYY-MM-DD)
  ?cursor=     (optional; RowKey to start after)
```

- Auth gate: same as layout — `resolvePermissions` must return `FULL_ACCESS`, else 403.
- Page size: 50 entries.
- When `category` is specified: query single partition `{category}#{date}` for each date in `[from, to]`.
- When `category` is omitted: query all five category partitions for each date in range and merge by timestamp descending.
- `cursor` maps to OData `$filter: RowKey gt '{cursor}'` (reverse-tick ordering means "gt" = older entries).
- Response: `{ entries: LogEntry[], nextCursor: string | null }`.

### `LogEntry` type

```ts
interface LogEntry {
  rowKey: string;
  category: LogCategory;
  level: LogLevel;
  message: string;
  timestamp: string;
  userId?: string;
  orgId?: string;
  metadata?: string; // raw JSON string
}
```

---

## Non-Goals

- No log deletion UI.
- No alerting or notifications.
- No log export (CSV/JSON download).
- No per-org scoped log views (admin sees all).
- No dashboard metrics (stub only).
