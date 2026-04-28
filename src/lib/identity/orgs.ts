// src/lib/identity/orgs.ts
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { Org } from "@/types/identity"

const TABLE = "Orgs"

export async function getOrg(orgId: string): Promise<Org | null> {
  const e = await tableGet<Org>(TABLE, "org", orgId)
  if (!e) return null
  return { orgId: e.rowKey as string, name: e.name as string, createdAt: e.createdAt as string, createdBy: e.createdBy as string }
}

export async function listOrgs(): Promise<Org[]> {
  const rows = await tableList<Org>(TABLE, "PartitionKey eq 'org'")
  return rows.map((e) => ({
    orgId: e.rowKey as string,
    name: e.name as string,
    createdAt: e.createdAt as string,
    createdBy: e.createdBy as string,
  }))
}

export async function createOrg(data: Pick<Org, "name" | "createdBy">): Promise<Org> {
  const orgId = randomUUID()
  const entity = {
    partitionKey: "org",
    rowKey: orgId,
    name: data.name,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy,
  }
  await tableUpsert(TABLE, entity)
  return { orgId, ...data, createdAt: entity.createdAt }
}

export async function deleteOrg(orgId: string): Promise<void> {
  await tableDelete(TABLE, "org", orgId)
}
