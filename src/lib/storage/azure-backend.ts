// src/lib/storage/azure-backend.ts
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
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

  constructor(location: StorageLocation, creds: AzureCredential) {
    // rootPath format: "accountname/container" — first segment is the account name
    this.accountName = location.rootPath.split("/")[0]
    this.client = this.buildClient(creds)
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
    // rootPath format: "accountname/container[/prefix]"
    // container is the second segment; prefix is everything after
    const parts = rootPath.split("/")
    const container = parts[1] ?? parts[0]
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
