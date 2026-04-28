// src/lib/storage/records.ts
import { createHash } from "crypto"
import { tableUpsert, tableList, tableGet } from "@/lib/auth/tables"

const TABLE = "Records"

export function recordRowKey(locationId: string, path: string): string {
  return createHash("sha256").update(`${locationId}:${path}`).digest("hex")
}

export interface RecordEntity {
  storageLocationId: string
  orgId: string
  path: string
  title?: string
  sizeBytes: number
  lastModified: string
  stale: boolean
  lastCrawledAt: string
  createdAt: string
}

export async function upsertRecord(
  locationId: string,
  orgId: string,
  entry: { path: string; sizeBytes: number; lastModified: Date },
  title?: string
): Promise<void> {
  const rk = recordRowKey(locationId, entry.path)
  const existing = await tableGet(TABLE, locationId, rk)
  await tableUpsert(TABLE, {
    partitionKey: locationId,
    rowKey: rk,
    storageLocationId: locationId,
    orgId,
    path: entry.path,
    title: title ?? null,
    sizeBytes: entry.sizeBytes,
    lastModified: entry.lastModified.toISOString(),
    stale: false,
    lastCrawledAt: new Date().toISOString(),
    createdAt: existing ? (existing as { createdAt: string }).createdAt : new Date().toISOString(),
  })
}

export async function markStaleRecords(
  locationId: string,
  seenPaths: Set<string>
): Promise<number> {
  const all = await tableList<RecordEntity>(TABLE, `PartitionKey eq '${locationId}'`)
  let count = 0
  for (const row of all) {
    if (!seenPaths.has(row.path) && !row.stale) {
      await tableUpsert(TABLE, { ...(row as object & { partitionKey: string; rowKey: string }), stale: true })
      count++
    }
  }
  return count
}

export async function getRecord(
  locationId: string,
  recordRK: string
): Promise<(RecordEntity & { partitionKey: string; rowKey: string }) | null> {
  return tableGet<RecordEntity>(TABLE, locationId, recordRK)
}

export async function listRecordsForLocation(locationId: string): Promise<RecordEntity[]> {
  return tableList<RecordEntity>(TABLE, `PartitionKey eq '${locationId}'`)
}
