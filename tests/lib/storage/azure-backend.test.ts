// tests/lib/storage/azure-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockListBlobsFlat = vi.fn()
const mockGetBlobClient = vi.fn()
const mockGenerateSasUrl = vi.fn()
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
