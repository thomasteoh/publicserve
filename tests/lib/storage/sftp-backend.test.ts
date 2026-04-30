// tests/lib/storage/sftp-backend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockConnect = vi.fn()
const mockList = vi.fn()
const mockGet = vi.fn()
const mockEnd = vi.fn()

vi.mock("ssh2-sftp-client", () => ({
  default: vi.fn(function () {
    return {
      connect: mockConnect,
      list: mockList,
      get: mockGet,
      end: mockEnd,
    }
  }),
}))

describe("SftpBackend.getSignedUrl", () => {
  it("returns null (SFTP has no signed URLs)", async () => {
    const { SftpBackend } = await import("@/lib/storage/sftp-backend")
    const creds = { type: "sftp_password", host: "h", port: 22, username: "u", password: "p" } as const
    const backend = new SftpBackend(creds, "/root")
    const result = await backend.getSignedUrl("any/path.html", 300)
    expect(result).toBeNull()
  })
})

describe("SftpBackend.list", () => {
  beforeEach(() => vi.clearAllMocks())

  it("yields StorageEntry for each file recursively", async () => {
    mockConnect.mockResolvedValue(undefined)
    mockEnd.mockResolvedValue(undefined)
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
    const backend = new SftpBackend(creds, "/root")
    const entries = []
    for await (const e of backend.list("/root")) entries.push(e)
    expect(entries.map((e) => e.path)).toContain("index.html")
    expect(entries.map((e) => e.path)).toContain("subdir/page.html")
  })
})

describe("SftpBackend.readStream", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fetches file using absolute path (rootPath joined with relative path)", async () => {
    mockConnect.mockResolvedValue(undefined)
    mockGet.mockResolvedValue(Buffer.from("<html/>"))
    mockEnd.mockResolvedValue(undefined)

    const { SftpBackend } = await import("@/lib/storage/sftp-backend")
    const creds = {
      type: "sftp_password" as const,
      host: "h",
      port: 22,
      username: "u",
      password: "p",
    }
    const backend = new SftpBackend(creds, "/remote/root")
    await backend.readStream("reports/index.html")
    expect(mockGet).toHaveBeenCalledWith("/remote/root/reports/index.html")
  })
})
