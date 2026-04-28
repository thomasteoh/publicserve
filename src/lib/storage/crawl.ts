// src/lib/storage/crawl.ts
import { getSecret } from "@/lib/keyvault"
import { createBackend } from "@/lib/storage/factory"
import { upsertRecord, markStaleRecords } from "@/lib/storage/records"
import { writeLog } from "@/lib/logging"
import type { StorageCredential, StorageLocation } from "@/lib/storage/types"

export interface CrawlResult {
  added: number
  updated: number
  stale: number
  unchanged: number
}

export async function runCrawl(location: StorageLocation): Promise<CrawlResult> {
  writeLog("crawl", "info", "crawl started", {
    orgId: location.orgId,
    locationId: location.storageLocationId,
  })

  try {
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
    const result: CrawlResult = { added, updated, stale, unchanged: 0 }

    writeLog("crawl", "info", "crawl completed", {
      orgId: location.orgId,
      locationId: location.storageLocationId,
      added: result.added,
      updated: result.updated,
      stale: result.stale,
      unchanged: result.unchanged,
    })

    return result
  } catch (err) {
    writeLog("crawl", "error", "crawl error", {
      orgId: location.orgId,
      locationId: location.storageLocationId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
