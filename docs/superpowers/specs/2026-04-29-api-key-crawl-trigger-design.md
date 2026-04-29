# API Key + Crawl Trigger Integration Design

## Goal

Allow external systems to trigger a full storage crawl (all locations for an org) via a bearer token API key, with org-scoped key management for users with `canConfigureIntegrations` permission.

## Scope

This spec covers the **backend only**: the API key data model, key management endpoints, and the crawl trigger endpoint. A UI for managing API keys will be built as part of a future org settings / integrations page.

---

## Data Model

### OrgApiKeys (Azure Table Storage)

One row per organisation. Upsert on rotation.

| Field | Type | Description |
|---|---|---|
| `partitionKey` | string | `orgId` |
| `rowKey` | string | `"key"` (fixed) |
| `keyHash` | string | SHA-256 of raw key (hex) |
| `keyPrefix` | string | First 8 chars of raw key (display/identification only) |
| `createdAt` | string | ISO timestamp of last generation |
| `createdBy` | string | userId who generated the key |
| `lastTriggeredAt` | string \| null | ISO timestamp of last successful crawl trigger (null if never triggered) |

### Key Format

`ps_` + 64 hex chars (32 random bytes). Total: 67 characters.

- `ps_` prefix identifies the platform
- Raw key shown **exactly once** at generation
- Only the SHA-256 hash is persisted

---

## API Surface

### Key Management Endpoints

Session-authenticated. All require `canConfigureIntegrations` (or `isAdmin`).

#### `GET /api/orgs/[orgId]/api-key`

Returns key metadata, or `null` if no key exists for the org.

**Response 200:**
```json
{
  "keyPrefix": "ps_1a2b3c",
  "createdAt": "2026-04-29T10:00:00.000Z",
  "createdBy": "user-uuid",
  "lastTriggeredAt": "2026-04-29T11:00:00.000Z"
}
```

**Response 200 (no key):**
```json
null
```

#### `POST /api/orgs/[orgId]/api-key`

Generates a new key. If one already exists, it is rotated (old key immediately invalidated).
`lastTriggeredAt` is preserved on rotation to prevent bypassing the rate limit by rotating the key.
Raw key returned **once** — caller must store it.

**Response 201:**
```json
{
  "rawKey": "ps_1a2b3c4d...",
  "keyPrefix": "ps_1a2b3c",
  "createdAt": "2026-04-29T10:00:00.000Z"
}
```

#### `DELETE /api/orgs/[orgId]/api-key`

Revokes the current key. Returns 204. No-ops if no key exists.

---

### Crawl Trigger Endpoint

No session required. Bearer token authentication only.

#### `POST /api/integrations/crawl`

**Request:**
```
Authorization: Bearer ps_<64hex>
Content-Type: application/json

{ "orgId": "uuid" }
```

**Validation sequence:**
1. Extract bearer token from `Authorization` header → `401` if missing or not `Bearer` scheme
2. Validate `orgId` present in body → `400` if missing
3. Hash token (SHA-256) → look up `OrgApiKeys` row for `orgId` → `401` if no key exists or hash mismatch
4. Check `lastTriggeredAt`: if within 60 seconds → `429 Too Many Requests` with `Retry-After: <seconds remaining>` header
5. Look up org → `404` if org does not exist
6. List storage locations for org → `422` if none found
7. Update `lastTriggeredAt` to now
8. Kick off fire-and-forget IIFE: run `runCrawl()` for each location sequentially
9. Return `202 Accepted`

**Response 202:**
```json
{
  "orgId": "uuid",
  "locationCount": 3
}
```

**Error responses:**

| Status | Condition |
|---|---|
| `400` | Missing `orgId` in body |
| `401` | Missing/malformed token, or token doesn't match org's key |
| `404` | Org not found |
| `422` | Org has no storage locations |
| `429` | Triggered within last 60 seconds; `Retry-After` header indicates seconds remaining |

---

## Rate Limiting

Fixed platform constant: **60-second cooldown** per org between trigger requests.

Implemented via `lastTriggeredAt` on the `OrgApiKeys` row — no external infra required.

---

## Audit Logging

- Key generated: `writeLog("auth", "info", "api key generated", { orgId, userId })`
- Key rotated: `writeLog("auth", "warn", "api key rotated", { orgId, userId })`
- Key revoked: `writeLog("auth", "warn", "api key revoked", { orgId, userId })`
- Crawl triggered via API: `writeLog("crawl", "info", "api-triggered crawl started", { orgId, locationCount })`
- Invalid key attempt: `writeLog("permission_denied", "warn", "invalid api key", { orgId })`
- Rate limit hit: `writeLog("permission_denied", "warn", "api crawl rate limited", { orgId })`

---

## File Structure

### New files

- `src/lib/identity/api-keys.ts` — all key operations:
  - `generateApiKey(orgId, userId): Promise<{ rawKey: string; keyPrefix: string; createdAt: string }>`
  - `revokeApiKey(orgId): Promise<void>`
  - `getApiKeyMeta(orgId): Promise<ApiKeyMeta | null>`
  - `validateApiKey(orgId, rawKey): Promise<{ valid: boolean; cooldownRemaining?: number }>`
  - `recordTrigger(orgId): Promise<void>`

- `src/app/api/orgs/[orgId]/api-key/route.ts` — GET / POST / DELETE handlers

- `src/app/api/integrations/crawl/route.ts` — POST crawl trigger

### Existing files used (no changes required)

- `src/lib/storage/locations.ts` — `listStorageLocations(orgId)`
- `src/lib/storage/crawl.ts` — `runCrawl(location)`
- `src/lib/logging.ts` — `writeLog()`
- `src/lib/permissions.ts` — `resolvePermissions()`
- `src/lib/identity/orgs.ts` — `getOrg(orgId)`
