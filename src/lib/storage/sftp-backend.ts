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
    // ssh2-sftp-client.get with no destination returns a Buffer
    const buf = await sftp.get(path) as Buffer
    await sftp.end()
    return Readable.from(buf)
  }

  async getSignedUrl(_path: string, _expiresInSecs: number): Promise<null> {
    return null
  }
}
