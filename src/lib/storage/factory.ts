// src/lib/storage/factory.ts
import type { StorageBackend, StorageCredential, StorageLocation, AzureCredential, S3Credential, SftpCredential } from "@/lib/storage/types"
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
      return new AzureBackend(location, creds as AzureCredential)
    case "s3":
      return new S3Backend(location, creds as S3Credential)
    case "sftp":
      return new SftpBackend(creds as SftpCredential)
    default:
      throw new Error(`Unknown storage type: ${(location as { type: string }).type}`)
  }
}
