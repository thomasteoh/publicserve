// src/lib/storage/types.ts
export interface StorageEntry {
  path: string
  sizeBytes: number
  lastModified: Date
}

export interface StorageBackend {
  list(rootPath: string): AsyncIterable<StorageEntry>
  readStream(path: string): Promise<NodeJS.ReadableStream>
  /** Returns null for backends that don't support signed URLs (SFTP) */
  getSignedUrl(path: string, expiresInSecs: number): Promise<string | null>
}

export type AzureStorageKeyCredential = { type: "storage_key"; accountKey: string }
export type AzureSasTokenCredential = { type: "sas_token"; sasToken: string }
export type AzureServicePrincipalCredential = { type: "service_principal"; clientId: string; clientSecret: string; tenantId: string }
export type AzureManagedIdentityCredential = { type: "managed_identity"; clientId?: string }
export type AwsAccessKeyCredential = { type: "aws_access_key"; accessKeyId: string; secretAccessKey: string; region: string; bucket: string }
export type AwsIamRoleCredential = { type: "aws_iam_role"; roleArn: string; region: string; bucket: string }
export type SftpPasswordCredential = { type: "sftp_password"; host: string; port: number; username: string; password: string }
export type SftpKeyCredential = { type: "sftp_key"; host: string; port: number; username: string; privateKey: string }

export type AzureCredential = AzureStorageKeyCredential | AzureSasTokenCredential | AzureServicePrincipalCredential | AzureManagedIdentityCredential
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
  credentialRef: string
  createdAt: string
  createdBy: string
}
