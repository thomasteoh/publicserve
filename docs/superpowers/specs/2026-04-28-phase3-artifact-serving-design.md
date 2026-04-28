# Phase 3 — Artifact Serving Design

**Project:** publicserve  
**Date:** 2026-04-28  
**Status:** Approved

## Overview

HTML artefacts stored in external storage (Azure ADLS/Blob, AWS S3, SFTP) are registered in a `Records` table. A triggered crawl walks a storage location at any depth and upserts records. Serving uses signed-URL redirect for Azure/S3 and server-side proxy streaming for SFTP.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend abstraction | `StorageBackend` interface | Each backend independently testable; route handlers stay thin |
| Supported backends | Azure ADLS Gen2, Azure Blob, S3, SFTP | As specified |
| Azure auth types | Storage Account key, SAS token, Service Principal, Managed Identity | Full coverage |
| S3 auth types | Access Key + Secret, IAM Role (assume-role) | Standard AWS patterns |
| SFTP auth types | Password, SSH private key | Standard SFTP |
| Credential storage | Key Vault, one secret per storage location (JSON) | Org-level isolation |
| Record identity | Deterministic `sha256(locationId + ":" + path)` as RowKey | Idempotent crawl upserts |
| Serve: Azure/S3 | Signed URL → 302 redirect | No proxy overhead |
| Serve: SFTP | Server-side proxy stream | SFTP has no signed URL concept |
| Crawl trigger | Manual API call only (no background crawl) | Explicit operator control |
| Stale records | Marked `stale=true`, not deleted | Preserves history; operator decides cleanup |

## StorageBackend Interface

```typescript
interface StorageBackend {
  list(path: string): AsyncIterable<StorageEntry>       // recursive, any depth
  readStream(path: string): Promise<NodeJS.ReadableStream>
  getSignedUrl(path: string, expiresInSecs: number): Promise<string | null>
  // getSignedUrl returns null for SFTP — caller falls back to proxy
}

interface StorageEntry {
  path: string       // relative to location root
  sizeBytes: number
  lastModified: Date
}
```

### Implementations

| Class | Backend | Notes |
|---|---|---|
| `AzureBackend` | Azure ADLS Gen2 / Blob | Uses `@azure/storage-blob` SDK; auth resolved from credential type |
| `S3Backend` | AWS S3 | Uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| `SftpBackend` | SFTP | Uses `ssh2-sftp-client`; `getSignedUrl` returns `null` |

Backend factory: `createBackend(location: StorageLocation, creds: StorageCredential): StorageBackend`

## Table Schemas

### `StorageLocations`

```
PK = {orgId}
RK = {storageLocationId}   (UUID)
```

| Field | Type | Notes |
|---|---|---|
| name | string | Human-readable label |
| type | `azure_adls \| azure_blob \| s3 \| sftp` | Determines backend class |
| rootPath | string | Base path within the storage system |
| credentialRef | string | Key Vault secret name: `storage-cred-{storageLocationId}` |
| createdAt | DateTime | |
| createdBy | string | userId |

Partition on `orgId` enables single-scan for all locations in an org.

### `Records`

```
PK = {storageLocationId}
RK = sha256(storageLocationId + ":" + path)   [hex, 64 chars]
```

| Field | Type | Notes |
|---|---|---|
| orgId | string | Denormalised for permission checks |
| storageLocationId | string | |
| path | string | Relative to location root, e.g. `reports/2024/q1/index.html` |
| title | string? | Extracted from HTML `<title>` tag during crawl |
| sizeBytes | number | |
| lastModified | DateTime | From storage backend |
| stale | boolean | `true` if not found in most recent crawl |
| lastCrawledAt | DateTime | |
| createdAt | DateTime | |

## Credential Storage in Key Vault

One secret per storage location. Secret name: `storage-cred-{storageLocationId}`.  
Secret value: JSON object, shape depends on auth type:

| Backend / Auth type | JSON fields |
|---|---|
| `azure` / `storage_key` | `{ "type": "storage_key", "accountKey": "..." }` |
| `azure` / `sas_token` | `{ "type": "sas_token", "sasToken": "..." }` |
| `azure` / `service_principal` | `{ "type": "service_principal", "clientId": "...", "clientSecret": "...", "tenantId": "..." }` |
| `azure` / `managed_identity` | `{ "type": "managed_identity", "clientId": "..." }` — `clientId` omitted for system-assigned |
| `s3` / `access_key` | `{ "type": "aws_access_key", "accessKeyId": "...", "secretAccessKey": "...", "region": "...", "bucket": "..." }` |
| `s3` / `iam_role` | `{ "type": "aws_iam_role", "roleArn": "...", "region": "...", "bucket": "..." }` |
| `sftp` / `password` | `{ "type": "sftp_password", "host": "...", "port": 22, "username": "...", "password": "..." }` |
| `sftp` / `ssh_key` | `{ "type": "sftp_key", "host": "...", "port": 22, "username": "...", "privateKey": "..." }` |

The credential JSON is validated against a discriminated union type at load time.

## API Endpoints

### Trigger Crawl

```
POST /api/orgs/{orgId}/storage-locations/{storageLocationId}/crawl
```

Auth: session with admin group OR `canConfigureIntegrations` on org.

**Flow:**
1. Load `StorageLocation` row from `StorageLocations[orgId, storageLocationId]`
2. Fetch credential JSON from Key Vault secret `storage-cred-{storageLocationId}`
3. `createBackend(location, creds)` → backend instance
4. `backend.list(rootPath)` → async iterate all files at any depth
5. Filter entries where `path.endsWith('.html')`
6. For each HTML file: upsert `Records` row (deterministic RK, idempotent)
7. For Records with `PK=storageLocationId` not seen this crawl: set `stale=true`
8. Return `{ added: number, updated: number, stale: number, unchanged: number }`

### Serve Record

```
GET /api/records/{storageLocationId}/{recordRK}/serve
```

Auth: session with `canRead` on record's org (or admin).

**Flow:**
1. Point-read `Records[storageLocationId, recordRK]`
2. Load `StorageLocation` + credentials
3. `createBackend(...)` → backend
4. `url = await backend.getSignedUrl(record.path, 300)`
5. If `url !== null` (Azure / S3): respond `302` to signed URL
6. If `url === null` (SFTP): `stream = await backend.readStream(record.path)` → pipe with `Content-Type: text/html`

## Access Control Summary

| Action | Required permission |
|---|---|
| List storage locations for org | `canRead` |
| Create / update / delete storage location | `canConfigureIntegrations` |
| Trigger crawl | `canConfigureIntegrations` |
| View records list | `canRead` |
| Serve record (view HTML) | `canRead` |
| Add / remove storage credential | `canConfigureIntegrations` |

Admin group bypasses all checks.

## Out of Scope (Phase 3)

- UI for storage location management (app implementation)
- Record search / filtering UI
- Automatic background crawl scheduling
- Record deletion (stale records accumulate; manual cleanup out of scope)
