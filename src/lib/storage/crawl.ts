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
    await upsertRecord(location.storageLocationId, location.orgId, entry, undefined)
    added++
  }

  const stale = await markStaleRecords(location.storageLocationId, seenPaths)

  return { added, updated, stale, unchanged: 0 }
}
