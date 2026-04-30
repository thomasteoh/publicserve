// tests/lib/storage/azure-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockListBlobsFlat = vi.fn()
const mockGetBlobClient = vi.fn()
const mockDownload = vi.fn()

vi.mock("@azure/storage-blob", () => {
  class MockBlobServiceClient {
    getContainerClient() {
      return {
        listBlobsFlat: mockListBlobsFlat,
        getBlobClient: mockGetBlobClient,
      }
    }
  }

  return {
    BlobServiceClient: MockBlobServiceClient,
    StorageSharedKeyCredential: vi.fn(),
    BlobSASPermissions: { parse: vi.fn(() => ({})) },
  }
})

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: vi.fn(),
  ManagedIdentityCredential: vi.fn(),
}))

describe("AzureBackend.list", () => {
  beforeEach(() => vi.clearAllMocks())

  it("yields path prefixed with container name", async () => {
    mockListBlobsFlat.mockReturnValue(
      (async function* () {
        yield {
          name: "reports/index.html",
          properties: { contentLength: 1024, lastModified: new Date("2024-01-01") },
        }
      })()
    )
    const { AzureBackend } = await import("@/lib/storage/azure-backend")
    const loc = { type: "azure_blob", rootPath: "myaccount/mycontainer" } as never
    const creds = { type: "storage_key", accountKey: "abc" } as never
    const backend = new AzureBackend(loc, creds)
    const entries: { path: string; sizeBytes: number }[] = []
    for await (const e of backend.list("myaccount/mycontainer")) {
      entries.push(e)
    }
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe("mycontainer/reports/index.html")
    expect(entries[0].sizeBytes).toBe(1024)
  })

  it("passes prefix option to listBlobsFlat when rootPath has prefix segment", async () => {
    mockListBlobsFlat.mockReturnValue((async function* () {})())
    const { AzureBackend } = await import("@/lib/storage/azure-backend")
    const loc = { type: "azure_blob", rootPath: "myaccount/mycontainer/reports" } as never
    const creds = { type: "storage_key", accountKey: "abc" } as never
    const backend = new AzureBackend(loc, creds)
    for await (const _ of backend.list("myaccount/mycontainer/reports")) {
      // consume
    }
    expect(mockListBlobsFlat).toHaveBeenCalledWith({ prefix: "reports" })
  })

  it("passes prefix: undefined when rootPath has no prefix segment", async () => {
    mockListBlobsFlat.mockReturnValue((async function* () {})())
    const { AzureBackend } = await import("@/lib/storage/azure-backend")
    const loc = { type: "azure_blob", rootPath: "myaccount/mycontainer" } as never
    const creds = { type: "storage_key", accountKey: "abc" } as never
    const backend = new AzureBackend(loc, creds)
    for await (const _ of backend.list("myaccount/mycontainer")) {
      // consume
    }
    expect(mockListBlobsFlat).toHaveBeenCalledWith({ prefix: undefined })
  })
})

describe("AzureBackend.readStream", () => {
  beforeEach(() => vi.clearAllMocks())

  it("parses container and blob path from container/blobpath format", async () => {
    const mockBlobClient = { download: mockDownload }
    mockGetBlobClient.mockReturnValue(mockBlobClient)
    mockDownload.mockResolvedValue({ readableStreamBody: { on: vi.fn() } })

    const { AzureBackend } = await import("@/lib/storage/azure-backend")
    const loc = { type: "azure_blob", rootPath: "myaccount/mycontainer" } as never
    const creds = { type: "storage_key", accountKey: "abc" } as never
    const backend = new AzureBackend(loc, creds)
    await backend.readStream("mycontainer/reports/index.html")
    expect(mockGetBlobClient).toHaveBeenCalledWith("reports/index.html")
  })
})
