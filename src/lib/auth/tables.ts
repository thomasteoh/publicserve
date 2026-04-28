// src/lib/auth/tables.ts
import { getTableClient } from "@/lib/azure-tables"

export async function tableGet<T extends object>(
  tableName: string,
  partitionKey: string,
  rowKey: string
): Promise<(T & { partitionKey: string; rowKey: string }) | null> {
  try {
    const client = getTableClient(tableName)
    const entity = await client.getEntity<T>(partitionKey, rowKey)
    return entity as T & { partitionKey: string; rowKey: string }
  } catch (err: unknown) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function tableUpsert<T extends { partitionKey: string; rowKey: string }>(
  tableName: string,
  entity: T
): Promise<void> {
  const client = getTableClient(tableName)
  await client.upsertEntity(entity, "Merge")
}

export async function tableDelete(
  tableName: string,
  partitionKey: string,
  rowKey: string
): Promise<void> {
  try {
    const client = getTableClient(tableName)
    await client.deleteEntity(partitionKey, rowKey)
  } catch (err: unknown) {
    if (isNotFound(err)) return
    throw err
  }
}

export async function tableList<T extends object>(
  tableName: string,
  filter: string
): Promise<(T & { partitionKey: string; rowKey: string })[]> {
  const client = getTableClient(tableName)
  const results: (T & { partitionKey: string; rowKey: string })[] = []
  for await (const entity of client.listEntities<T>({ queryOptions: { filter } })) {
    results.push(entity as T & { partitionKey: string; rowKey: string })
  }
  return results
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 404
}
