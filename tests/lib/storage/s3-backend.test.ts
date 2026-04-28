// tests/lib/storage/s3-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSend = vi.fn()
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () { return { send: mockSend } }),
  ListObjectsV2Command: vi.fn(function (input) { return { input } }),
  GetObjectCommand: vi.fn(function (input) { return { input } }),
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
