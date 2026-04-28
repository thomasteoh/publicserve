// src/lib/storage/s3-backend.ts
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { StorageBackend, StorageEntry, S3Credential, StorageLocation } from "@/lib/storage/types"
import type { Readable } from "stream"

export class S3Backend implements StorageBackend {
  private client: S3Client
  private bucket: string

  constructor(_location: StorageLocation, creds: S3Credential) {
    this.bucket = creds.bucket
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
    // aws_iam_role: use default credential chain
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
