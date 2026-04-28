# Phase 3: Artifact Serving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement storage location management, triggered HTML crawl, and per-record serve (signed-URL redirect for Azure/S3, proxy stream for SFTP).

**Architecture:** `StorageBackend` interface with three implementations (Azure, S3, SFTP). Backend factory resolves from `StorageLocation` type. Credentials stored as JSON in Key Vault, one secret per location. Records identified by `sha256(locationId + ":" + path)`.

**Tech Stack:** `@azure/storage-blob`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/sts-client`, `ssh2-sftp-client`, `@azure/keyvault-secrets`, `@azure/identity`, Vitest

---

## File Structure

```
src/
  lib/
    keyvault.ts                       # Key Vault secret fetch (via managed identity)
    storage/
      types.ts                        # StorageBackend interface, StorageEntry, credential union type
      factory.ts                      # createBackend(location, creds) → StorageBackend
      azure-backend.ts                # AzureBackend implements StorageBackend
      s3-backend.ts                   # S3Backend implements StorageBackend
      sftp-backend.ts                 # SftpBackend implements StorageBackend
  app/
    api/
      orgs/
        [orgId]/
          storage-locations/
            route.ts                  # GET (list), POST (create)
            [locationId]/
              route.ts                # GET, PATCH, DELETE
              crawl/
                route.ts             # POST /crawl
      records/
        [locationId]/
          [recordRK]/
            serve/
              route.ts               # GET /serve
tests/
  lib/
    storage/
      azure-backend.test.ts
      s3-backend.test.ts
      sftp-backend.test.ts
      factory.test.ts
    crawl.test.ts
```

---

## Task 1: Key Vault Helper

**Files:**
- Create: `src/lib/keyvault.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/lib/keyvault.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetSecret = vi.fn()
vi.mock("@azure/keyvault-secrets", () => ({
  SecretClient: vi.fn(() => ({ getSecret: mockGetSecret })),
}))
vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn(),
}))

describe("getSecret", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns parsed secret value", async () => {
    process.env.AZURE_KEYVAULT_URI = "https://kv-publicserve-nprod.vault.azure.net/"
    mockGetSecret.mockResolvedValue({ value: '{"type":"storage_key","accountKey":"abc123"}' })
    const { getSecret } = await import("@/lib/keyvault")
    const result = await getSecret("storage-cred-abc")
    expect(result).toEqual({ type: "storage_key", accountKey: "abc123" })
  })

  it("throws when AZURE_KEYVAULT_URI is missing", async () => {
    delete process.env.AZURE_KEYVAULT_URI
    vi.resetModules()
    const { getSecret } = await import("@/lib/keyvault")
    await expect(getSecret("any")).rejects.toThrow("AZURE_KEYVAULT_URI")
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/lib/keyvault.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Install Key Vault dependencies**

```bash
npm install @azure/keyvault-secrets @azure/identity
```

- [ ] **Step 4: Implement src/lib/keyvault.ts**

```ts
// src/lib/keyvault.ts
import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"

let _client: SecretClient | null = null

function getClient(): SecretClient {
  if (_client) return _client
  const uri = process.env.AZURE_KEYVAULT_URI
  if (!uri) throw new Error("AZURE_KEYVAULT_URI is not set")
  _client = new SecretClient(uri, new DefaultAzureCredential())
  return _client
}

export async function getSecret<T = unknown>(secretName: string): Promise<T> {
  const client = getClient()
  const secret = await client.getSecret(secretName)
  if (!secret.value) throw new Error(`Secret ${secretName} has no value`)
  return JSON.parse(secret.value) as T
}

export async function setSecret(secretName: string, value: unknown): Promise<void> {
  const client = getClient()
  await client.setSecret(secretName, JSON.stringify(value))
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/keyvault.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/keyvault.ts tests/lib/keyvault.test.ts
git commit -m "feat(storage): add Key Vault secret helper"
```

---

## Task 2: StorageBackend Types + Factory

**Files:**
- Create: `src/lib/storage/types.ts`
- Create: `src/lib/storage/factory.ts`

- [ ] **Step 1: Create src/lib/storage/types.ts**

```ts
// src/lib/storage/types.ts
export interface StorageEntry {
  path: string        // relative to location root
  sizeBytes: number
  lastModified: Date
}

export interface StorageBackend {
  list(rootPath: string): AsyncIterable<StorageEntry>
  readStream(path: string): Promise<NodeJS.ReadableStream>
  /** Returns null for backends that don't support signed URLs (SFTP) */
  getSignedUrl(path: string, expiresInSecs: number): Promise<string | null>
}

// ---- Credential union ----

export type AzureStorageKeyCredential = {
  type: "storage_key"
  accountKey: string
}

export type AzureSasTokenCredential = {
  type: "sas_token"
  sasToken: string
}

export type AzureServicePrincipalCredential = {
  type: "service_principal"
  clientId: string
  clientSecret: string
  tenantId: string
}

export type AzureManagedIdentityCredential = {
  type: "managed_identity"
  clientId?: string   // omit for system-assigned
}

export type AwsAccessKeyCredential = {
  type: "aws_access_key"
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
}

export type AwsIamRoleCredential = {
  type: "aws_iam_role"
  roleArn: string
  region: string
  bucket: string
}

export type SftpPasswordCredential = {
  type: "sftp_password"
  host: string
  port: number
  username: string
  password: string
}

export type SftpKeyCredential = {
  type: "sftp_key"
  host: string
  port: number
  username: string
  privateKey: string
}

export type AzureCredential =
  | AzureStorageKeyCredential
  | AzureSasTokenCredential
  | AzureServicePrincipalCredential
  | AzureManagedIdentityCredential

export type S3Credential = AwsAccessKeyCredential | AwsIamRoleCredential

export type SftpCredential = SftpPasswordCredential | SftpKeyCredential

export type StorageCredential = AzureCredential | S3Credential | SftpCredential

export type StorageLocationType = "azure_adls" | "azure_blob" | "s3" | "sftp"

export interface StorageLocation {
  storageLocationId: string
  orgId: string
  name: string
  type: StorageLocationType
  rootPath: string
  credentialRef: string   // Key Vault secret name
  createdAt: string
  createdBy: string
}
```

- [ ] **Step 2: Write failing test for factory**

```ts
// tests/lib/storage/factory.test.ts
import { describe, it, expect } from "vitest"

describe("createBackend", () => {
  it("throws for unknown type", async () => {
    const { createBackend } = await import("@/lib/storage/factory")
    const loc = { type: "unknown" } as never
    const creds = {} as never
    expect(() => createBackend(loc, creds)).toThrow("Unknown storage type")
  })
})
```

- [ ] **Step 3: Run test — expect failure**

```bash
npx vitest run tests/lib/storage/factory.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement src/lib/storage/factory.ts**

```ts
// src/lib/storage/factory.ts
import type { StorageBackend, StorageCredential, StorageLocation } from "@/lib/storage/types"
import { AzureBackend } from "@/lib/storage/azure-backend"
import { S3Backend } from "@/lib/storage/s3-backend"
import { SftpBackend } from "@/lib/storage/sftp-backend"

export function createBackend(
  location: StorageLocation,
  creds: StorageCredential
): StorageBackend {
  switch (location.type) {
    case "azure_adls":
    case "azure_blob":
      return new AzureBackend(location, creds as Parameters<typeof AzureBackend>[1])
    case "s3":
      return new S3Backend(location, creds as Parameters<typeof S3Backend>[1])
    case "sftp":
      return new SftpBackend(creds as Parameters<typeof SftpBackend>[0])
    default:
      throw new Error(`Unknown storage type: ${(location as { type: string }).type}`)
  }
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/storage/factory.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/types.ts src/lib/storage/factory.ts tests/lib/storage/factory.test.ts
git commit -m "feat(storage): add StorageBackend types and factory"
```

---

## Task 3: Azure Backend

**Files:**
- Create: `src/lib/storage/azure-backend.ts`
- Create: `tests/lib/storage/azure-backend.test.ts`

- [ ] **Step 1: Install Azure Blob Storage SDK**

```bash
npm install @azure/storage-blob
```

- [ ] **Step 2: Write failing test**

```ts
// tests/lib/storage/azure-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockListBlobsFlat = vi.fn()
const mockGetBlobClient = vi.fn()
const mockGenerateSasUrl = vi.fn()
const mockDownload = vi.fn()

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: vi.fn(() => ({
    getContainerClient: vi.fn(() => ({
      listBlobsFlat: mockListBlobsFlat,
      getBlobClient: mockGetBlobClient,
    })),
  })),
  StorageSharedKeyCredential: vi.fn(),
  generateBlobSASQueryParameters: vi.fn(() => "sas=token"),
  BlobSASPermissions: { parse: vi.fn(() => ({})) },
}))

describe("AzureBackend.list", () => {
  it("yields StorageEntry for each blob", async () => {
    mockListBlobsFlat.mockReturnValue((async function* () {
      yield { name: "reports/index.html", properties: { contentLength: 1024, lastModified: new Date("2024-01-01") } }
    })())
    const { AzureBackend } = await import("@/lib/storage/azure-backend")
    const loc = { type: "azure_blob", rootPath: "mycontainer" } as never
    const creds = { type: "storage_key", accountKey: "abc" } as never
    const backend = new AzureBackend(loc, creds)
    const entries = []
    for await (const e of backend.list("mycontainer")) {
      entries.push(e)
    }
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe("reports/index.html")
    expect(entries[0].sizeBytes).toBe(1024)
  })
})
```

- [ ] **Step 3: Run test — expect failure**

```bash
npx vitest run tests/lib/storage/azure-backend.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement src/lib/storage/azure-backend.ts**

```ts
// src/lib/storage/azure-backend.ts
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from "@azure/storage-blob"
import { ClientSecretCredential, ManagedIdentityCredential } from "@azure/identity"
import type {
  StorageBackend,
  StorageEntry,
  AzureCredential,
  StorageLocation,
} from "@/lib/storage/types"

export class AzureBackend implements StorageBackend {
  private client: BlobServiceClient
  private accountName: string
  private credential: AzureCredential

  constructor(location: StorageLocation, creds: AzureCredential) {
    this.credential = creds
    // Extract account name from rootPath format: "accountname/container" or just "container"
    // rootPath expected format: "<container-name>" with account embedded in creds or derived
    // For azure_adls/azure_blob, rootPath = container name
    this.accountName = this.resolveAccountName(location.rootPath)
    this.client = this.buildClient(creds)
  }

  private resolveAccountName(rootPath: string): string {
    // rootPath format: "accountname/container" — take first segment as account
    return rootPath.split("/")[0]
  }

  private buildClient(creds: AzureCredential): BlobServiceClient {
    const url = `https://${this.accountName}.blob.core.windows.net`
    switch (creds.type) {
      case "storage_key":
        return new BlobServiceClient(
          url,
          new StorageSharedKeyCredential(this.accountName, creds.accountKey)
        )
      case "sas_token":
        return new BlobServiceClient(`${url}?${creds.sasToken}`)
      case "service_principal":
        return new BlobServiceClient(
          url,
          new ClientSecretCredential(creds.tenantId, creds.clientId, creds.clientSecret)
        )
      case "managed_identity":
        return new BlobServiceClient(
          url,
          creds.clientId
            ? new ManagedIdentityCredential(creds.clientId)
            : new ManagedIdentityCredential()
        )
    }
  }

  async *list(rootPath: string): AsyncIterable<StorageEntry> {
    const container = rootPath.split("/").slice(1).join("/") || rootPath
    const containerClient = this.client.getContainerClient(container)
    for await (const blob of containerClient.listBlobsFlat()) {
      yield {
        path: blob.name,
        sizeBytes: blob.properties.contentLength ?? 0,
        lastModified: blob.properties.lastModified ?? new Date(),
      }
    }
  }

  async readStream(path: string): Promise<NodeJS.ReadableStream> {
    const [container, ...rest] = path.split("/")
    const blobPath = rest.join("/")
    const blobClient = this.client.getContainerClient(container).getBlobClient(blobPath)
    const download = await blobClient.download()
    if (!download.readableStreamBody) throw new Error(`No stream for ${path}`)
    return download.readableStreamBody as NodeJS.ReadableStream
  }

  async getSignedUrl(path: string, expiresInSecs: number): Promise<string> {
    const [container, ...rest] = path.split("/")
    const blobPath = rest.join("/")
    const blobClient = this.client.getContainerClient(container).getBlobClient(blobPath)
    const expiresOn = new Date(Date.now() + expiresInSecs * 1000)
    return blobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    })
  }
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/storage/azure-backend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/azure-backend.ts tests/lib/storage/azure-backend.test.ts
git commit -m "feat(storage): add AzureBackend"
```

---

## Task 4: S3 Backend

**Files:**
- Create: `src/lib/storage/s3-backend.ts`
- Create: `tests/lib/storage/s3-backend.test.ts`

- [ ] **Step 1: Install AWS SDK**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/client-sts
```

- [ ] **Step 2: Write failing test**

```ts
// tests/lib/storage/s3-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSend = vi.fn()
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  ListObjectsV2Command: vi.fn((input) => ({ input })),
  GetObjectCommand: vi.fn((input) => ({ input })),
}))
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(() => Promise.resolve("https://s3.example.com/signed")),
}))

describe("S3Backend.list", () => {
  beforeEach(() => vi.clearAllMocks())

  it("yields entries for all objects", async () => {
    mockSend.mockResolvedValueOnce({
      Contents: [
        { Key: "reports/index.html", Size: 512, LastModified: new Date("2024-06-01") },
      ],
      IsTruncated: false,
    })
    const { S3Backend } = await import("@/lib/storage/s3-backend")
    const creds = { type: "aws_access_key", accessKeyId: "key", secretAccessKey: "secret", region: "us-east-1", bucket: "my-bucket" } as const
    const backend = new S3Backend({ rootPath: "", type: "s3" } as never, creds)
    const entries = []
    for await (const e of backend.list("")) entries.push(e)
    expect(entries[0].path).toBe("reports/index.html")
    expect(entries[0].sizeBytes).toBe(512)
  })

  it("getSignedUrl returns presigned URL", async () => {
    const { S3Backend } = await import("@/lib/storage/s3-backend")
    const creds = { type: "aws_access_key", accessKeyId: "k", secretAccessKey: "s", region: "us-east-1", bucket: "b" } as const
    const backend = new S3Backend({ rootPath: "", type: "s3" } as never, creds)
    const url = await backend.getSignedUrl("reports/index.html", 300)
    expect(url).toContain("https://")
  })
})
```

- [ ] **Step 3: Run test — expect failure**

```bash
npx vitest run tests/lib/storage/s3-backend.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement src/lib/storage/s3-backend.ts**

```ts
// src/lib/storage/s3-backend.ts
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts"
import type { StorageBackend, StorageEntry, S3Credential, StorageLocation } from "@/lib/storage/types"
import type { Readable } from "stream"

export class S3Backend implements StorageBackend {
  private client: S3Client
  private bucket: string

  constructor(_location: StorageLocation, creds: S3Credential) {
    this.bucket = creds.type === "aws_access_key" ? creds.bucket : creds.bucket ?? ""
    this.client = this.buildClient(creds)
  }

  private buildClient(creds: S3Credential): S3Client {
    if (creds.type === "aws_access_key") {
      return new S3Client({
        region: creds.region,
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
        },
      })
    }
    // aws_iam_role: use default credential chain (assumes role externally or via env)
    return new S3Client({ region: creds.region })
  }

  async *list(rootPath: string): AsyncIterable<StorageEntry> {
    let continuationToken: string | undefined
    do {
      const cmd = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: rootPath || undefined,
        ContinuationToken: continuationToken,
      })
      const resp = await this.client.send(cmd)
      for (const obj of resp.Contents ?? []) {
        if (!obj.Key) continue
        yield {
          path: obj.Key,
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(),
        }
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined
    } while (continuationToken)
  }

  async readStream(path: string): Promise<NodeJS.ReadableStream> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: path })
    const resp = await this.client.send(cmd)
    if (!resp.Body) throw new Error(`No body for ${path}`)
    return resp.Body as Readable
  }

  async getSignedUrl(path: string, expiresInSecs: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: path })
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSecs })
  }
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/storage/s3-backend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/s3-backend.ts tests/lib/storage/s3-backend.test.ts
git commit -m "feat(storage): add S3Backend"
```

---

## Task 5: SFTP Backend

**Files:**
- Create: `src/lib/storage/sftp-backend.ts`
- Create: `tests/lib/storage/sftp-backend.test.ts`

- [ ] **Step 1: Install SFTP client**

```bash
npm install ssh2-sftp-client
npm install -D @types/ssh2-sftp-client
```

- [ ] **Step 2: Write failing test**

```ts
// tests/lib/storage/sftp-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockConnect = vi.fn()
const mockList = vi.fn()
const mockGet = vi.fn()
const mockEnd = vi.fn()

vi.mock("ssh2-sftp-client", () => ({
  default: vi.fn(() => ({
    connect: mockConnect,
    list: mockList,
    get: mockGet,
    end: mockEnd,
  })),
}))

describe("SftpBackend.getSignedUrl", () => {
  it("returns null (SFTP has no signed URLs)", async () => {
    const { SftpBackend } = await import("@/lib/storage/sftp-backend")
    const creds = { type: "sftp_password", host: "h", port: 22, username: "u", password: "p" } as const
    const backend = new SftpBackend(creds)
    const result = await backend.getSignedUrl("any/path.html", 300)
    expect(result).toBeNull()
  })
})

describe("SftpBackend.list", () => {
  beforeEach(() => vi.clearAllMocks())

  it("yields StorageEntry for each file recursively", async () => {
    mockConnect.mockResolvedValue(undefined)
    mockEnd.mockResolvedValue(undefined)
    // First call returns a dir and a file; second call (subdir) returns one file
    mockList
      .mockResolvedValueOnce([
        { name: "subdir", type: "d", size: 0, modifyTime: Date.now() },
        { name: "index.html", type: "-", size: 800, modifyTime: Date.now() },
      ])
      .mockResolvedValueOnce([
        { name: "page.html", type: "-", size: 400, modifyTime: Date.now() },
      ])

    const { SftpBackend } = await import("@/lib/storage/sftp-backend")
    const creds = { type: "sftp_password", host: "h", port: 22, username: "u", password: "p" } as const
    const backend = new SftpBackend(creds)
    const entries = []
    for await (const e of backend.list("/root")) entries.push(e)
    expect(entries.map((e) => e.path)).toContain("index.html")
    expect(entries.map((e) => e.path)).toContain("subdir/page.html")
  })
})
```

- [ ] **Step 3: Run test — expect failure**

```bash
npx vitest run tests/lib/storage/sftp-backend.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement src/lib/storage/sftp-backend.ts**

```ts
// src/lib/storage/sftp-backend.ts
import SftpClient from "ssh2-sftp-client"
import type { StorageBackend, StorageEntry, SftpCredential } from "@/lib/storage/types"
import { Readable } from "stream"

export class SftpBackend implements StorageBackend {
  constructor(private creds: SftpCredential) {}

  private connectOptions() {
    const base = { host: this.creds.host, port: this.creds.port, username: this.creds.username }
    if (this.creds.type === "sftp_password") {
      return { ...base, password: this.creds.password }
    }
    return { ...base, privateKey: this.creds.privateKey }
  }

  async *list(rootPath: string): AsyncIterable<StorageEntry> {
    const sftp = new SftpClient()
    await sftp.connect(this.connectOptions())
    try {
      yield* this.listRecursive(sftp, rootPath, "")
    } finally {
      await sftp.end()
    }
  }

  private async *listRecursive(
    sftp: SftpClient,
    basePath: string,
    relPrefix: string
  ): AsyncIterable<StorageEntry> {
    const entries = await sftp.list(basePath)
    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      if (entry.type === "d") {
        yield* this.listRecursive(sftp, `${basePath}/${entry.name}`, relPath)
      } else {
        yield {
          path: relPath,
          sizeBytes: entry.size,
          lastModified: new Date(entry.modifyTime),
        }
      }
    }
  }

  async readStream(path: string): Promise<NodeJS.ReadableStream> {
    const sftp = new SftpClient()
    await sftp.connect(this.connectOptions())
    const chunks: Buffer[] = []
    await sftp.get(path, undefined, { readStreamOptions: { autoClose: true } } as never)
    // ssh2-sftp-client.get with no dest returns a Buffer
    const buf = await sftp.get(path) as Buffer
    await sftp.end()
    return Readable.from(buf)
  }

  async getSignedUrl(_path: string, _expiresInSecs: number): Promise<null> {
    return null
  }
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/storage/sftp-backend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/sftp-backend.ts tests/lib/storage/sftp-backend.test.ts
git commit -m "feat(storage): add SftpBackend"
```

---

## Task 6: StorageLocations Table Operations

**Files:**
- Create: `src/lib/storage/locations.ts`

- [ ] **Step 1: Write failing test**

```ts
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
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/lib/storage/locations.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/lib/storage/locations.ts**

```ts
// src/lib/storage/locations.ts
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { StorageLocation } from "@/lib/storage/types"

const TABLE = "StorageLocations"

export async function getStorageLocation(
  orgId: string,
  locationId: string
): Promise<StorageLocation | null> {
  const e = await tableGet(TABLE, orgId, locationId)
  if (!e) return null
  return entityToLocation(e as Record<string, unknown>)
}

export async function listStorageLocations(orgId: string): Promise<StorageLocation[]> {
  const rows = await tableList(TABLE, `PartitionKey eq '${orgId}'`)
  return rows.map((e) => entityToLocation(e as Record<string, unknown>))
}

export async function createStorageLocation(
  data: Omit<StorageLocation, "storageLocationId" | "createdAt">
): Promise<StorageLocation> {
  const storageLocationId = randomUUID()
  const entity = {
    partitionKey: data.orgId,
    rowKey: storageLocationId,
    name: data.name,
    type: data.type,
    rootPath: data.rootPath,
    credentialRef: `storage-cred-${storageLocationId}`,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy,
  }
  await tableUpsert(TABLE, entity)
  return entityToLocation(entity as Record<string, unknown>)
}

export async function deleteStorageLocation(orgId: string, locationId: string): Promise<void> {
  await tableDelete(TABLE, orgId, locationId)
}

function entityToLocation(e: Record<string, unknown>): StorageLocation {
  return {
    storageLocationId: e.rowKey as string,
    orgId: e.partitionKey as string,
    name: e.name as string,
    type: e.type as StorageLocation["type"],
    rootPath: e.rootPath as string,
    credentialRef: e.credentialRef as string,
    createdAt: e.createdAt as string,
    createdBy: e.createdBy as string,
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/storage/locations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/locations.ts tests/lib/storage/locations.test.ts
git commit -m "feat(storage): add StorageLocations table operations"
```

---

## Task 7: Records Table Operations + Crawl Helper

**Files:**
- Create: `src/lib/storage/records.ts`
- Create: `tests/lib/crawl.test.ts`

- [ ] **Step 1: Implement src/lib/storage/records.ts**

```ts
// src/lib/storage/records.ts
import { createHash } from "crypto"
import { tableUpsert, tableList, tableGet } from "@/lib/auth/tables"

const TABLE = "Records"

export function recordRowKey(locationId: string, path: string): string {
  return createHash("sha256").update(`${locationId}:${path}`).digest("hex")
}

export interface RecordEntity {
  storageLocationId: string
  orgId: string
  path: string
  title?: string
  sizeBytes: number
  lastModified: string
  stale: boolean
  lastCrawledAt: string
  createdAt: string
}

export async function upsertRecord(
  locationId: string,
  orgId: string,
  entry: { path: string; sizeBytes: number; lastModified: Date },
  title?: string
): Promise<void> {
  const rk = recordRowKey(locationId, entry.path)
  const existing = await tableGet(TABLE, locationId, rk)
  await tableUpsert(TABLE, {
    partitionKey: locationId,
    rowKey: rk,
    storageLocationId: locationId,
    orgId,
    path: entry.path,
    title: title ?? null,
    sizeBytes: entry.sizeBytes,
    lastModified: entry.lastModified.toISOString(),
    stale: false,
    lastCrawledAt: new Date().toISOString(),
    createdAt: existing ? (existing as { createdAt: string }).createdAt : new Date().toISOString(),
  })
}

export async function markStaleRecords(
  locationId: string,
  seenPaths: Set<string>
): Promise<number> {
  const all = await tableList<RecordEntity>(TABLE, `PartitionKey eq '${locationId}'`)
  let count = 0
  for (const row of all) {
    if (!seenPaths.has(row.path) && !row.stale) {
      await tableUpsert(TABLE, { ...(row as object & { partitionKey: string; rowKey: string }), stale: true })
      count++
    }
  }
  return count
}

export async function getRecord(
  locationId: string,
  recordRK: string
): Promise<(RecordEntity & { partitionKey: string; rowKey: string }) | null> {
  return tableGet<RecordEntity>(TABLE, locationId, recordRK)
}

export async function listRecordsForLocation(locationId: string): Promise<RecordEntity[]> {
  return tableList<RecordEntity>(TABLE, `PartitionKey eq '${locationId}'`)
}
```

- [ ] **Step 2: Write failing crawl test**

```ts
// tests/lib/crawl.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

import { createHash } from "crypto"

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
    expect(upsertRecord).toHaveBeenCalledWith("loc-1", "org-1", expect.objectContaining({ path: "report.html" }), undefined)
    expect(markStaleRecords).toHaveBeenCalledWith("loc-1", new Set(["report.html"]))
    expect(result.added + result.updated).toBe(1)
    expect(result.stale).toBe(1)
  })
})
```

- [ ] **Step 3: Run test — expect failure**

```bash
npx vitest run tests/lib/crawl.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement src/lib/storage/crawl.ts**

```ts
// src/lib/storage/crawl.ts
import { getSecret } from "@/lib/keyvault"
import { createBackend } from "@/lib/storage/factory"
import { upsertRecord, markStaleRecords } from "@/lib/storage/records"
import type { StorageCredential, StorageLocation } from "@/lib/storage/types"

export interface CrawlResult {
  added: number
  updated: number
  stale: number
  unchanged: number
}

export async function runCrawl(location: StorageLocation): Promise<CrawlResult> {
  const creds = await getSecret<StorageCredential>(location.credentialRef)
  const backend = createBackend(location, creds)

  const seenPaths = new Set<string>()
  let added = 0
  let updated = 0

  for await (const entry of backend.list(location.rootPath)) {
    if (!entry.path.endsWith(".html")) continue
    seenPaths.add(entry.path)
    await upsertRecord(location.storageLocationId, location.orgId, entry)
    // We don't distinguish add vs update here without a pre-check — both count as upserted
    added++
  }

  const stale = await markStaleRecords(location.storageLocationId, seenPaths)

  return { added, updated, stale, unchanged: 0 }
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/crawl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/records.ts src/lib/storage/crawl.ts tests/lib/crawl.test.ts
git commit -m "feat(storage): add Records table operations and crawl logic"
```

---

## Task 8: API Routes — Crawl Endpoint

**Files:**
- Create: `src/app/api/orgs/[orgId]/storage-locations/[locationId]/crawl/route.ts`

- [ ] **Step 1: Implement crawl route**

```ts
// src/app/api/orgs/[orgId]/storage-locations/[locationId]/crawl/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { getStorageLocation } from "@/lib/storage/locations"
import { runCrawl } from "@/lib/storage/crawl"

export async function POST(
  _req: Request,
  { params }: { params: { orgId: string; locationId: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const perms = await resolvePermissions(session.user.id, params.orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const location = await getStorageLocation(params.orgId, params.locationId)
  if (!location) {
    return NextResponse.json({ error: "Storage location not found" }, { status: 404 })
  }

  const result = await runCrawl(location)
  return NextResponse.json(result)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/orgs/
git commit -m "feat(storage): add crawl API endpoint"
```

---

## Task 9: Serve Endpoint

**Files:**
- Create: `src/app/api/records/[locationId]/[recordRK]/serve/route.ts`

- [ ] **Step 1: Implement serve route**

```ts
// src/app/api/records/[locationId]/[recordRK]/serve/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { getRecord } from "@/lib/storage/records"
import { getStorageLocation } from "@/lib/storage/locations"
import { getSecret } from "@/lib/keyvault"
import { createBackend } from "@/lib/storage/factory"
import type { StorageCredential } from "@/lib/storage/types"
import { Readable } from "stream"

export async function GET(
  _req: Request,
  { params }: { params: { locationId: string; recordRK: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const record = await getRecord(params.locationId, params.recordRK)
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const perms = await resolvePermissions(session.user.id, record.orgId)
  if (!perms.isAdmin && !perms.canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const location = await getStorageLocation(record.orgId, params.locationId)
  if (!location) {
    return NextResponse.json({ error: "Storage location not found" }, { status: 404 })
  }

  const creds = await getSecret<StorageCredential>(location.credentialRef)
  const backend = createBackend(location, creds)

  const signedUrl = await backend.getSignedUrl(record.path, 300)

  if (signedUrl !== null) {
    return NextResponse.redirect(signedUrl, 302)
  }

  // SFTP: proxy stream
  const stream = await backend.readStream(record.path)
  const webStream = Readable.toWeb(stream as Readable) as ReadableStream
  return new Response(webStream, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/records/
git commit -m "feat(storage): add record serve endpoint (redirect + proxy)"
```

---

## Task 10: Run All Tests

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.
