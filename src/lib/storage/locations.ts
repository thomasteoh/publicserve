// src/lib/storage/locations.ts
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { StorageLocation } from "@/lib/storage/types"

const TABLE = "StorageLocations"

export async function getStorageLocation(
  orgId: string,
  locationId: string
): Promise<StorageLocation | null> {
  const e = await tableGet(TABLE, orgId, locationId)
  if (!e) return null
  return entityToLocation(e as Record<string, unknown>)
}

export async function listStorageLocations(orgId: string): Promise<StorageLocation[]> {
  const rows = await tableList(TABLE, `PartitionKey eq '${orgId}'`)
  return rows.map((e) => entityToLocation(e as Record<string, unknown>))
}

export async function createStorageLocation(
  data: Omit<StorageLocation, "storageLocationId" | "createdAt" | "credentialRef">
): Promise<StorageLocation> {
  const storageLocationId = randomUUID()
  const entity = {
    partitionKey: data.orgId,
    rowKey: storageLocationId,
    name: data.name,
    type: data.type,
    rootPath: data.rootPath,
    credentialRef: `storage-cred-${storageLocationId}`,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy,
  }
  await tableUpsert(TABLE, entity)
  return entityToLocation(entity as Record<string, unknown>)
}

export async function deleteStorageLocation(orgId: string, locationId: string): Promise<void> {
  await tableDelete(TABLE, orgId, locationId)
}

function entityToLocation(e: Record<string, unknown>): StorageLocation {
  return {
    storageLocationId: e.rowKey as string,
    orgId: e.partitionKey as string,
    name: e.name as string,
    type: e.type as StorageLocation["type"],
    rootPath: e.rootPath as string,
    credentialRef: e.credentialRef as string,
    createdAt: e.createdAt as string,
    createdBy: e.createdBy as string,
  }
}
