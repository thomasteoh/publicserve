// src/lib/identity/groups.ts
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { Group } from "@/types/identity"

const TABLE = "Groups"

export async function getGroup(groupId: string): Promise<Group | null> {
  const e = await tableGet<Group>(TABLE, "group", groupId)
  if (!e) return null
  return entityToGroup(e)
}

export async function listGroups(): Promise<Group[]> {
  const rows = await tableList<Group>(TABLE, "PartitionKey eq 'group'")
  return rows.map(entityToGroup)
}

export async function createGroup(
  data: Pick<Group, "name" | "isAdmin" | "createdBy">
): Promise<Group> {
  const groupId = randomUUID()
  const entity = {
    partitionKey: "group",
    rowKey: groupId,
    name: data.name,
    isAdmin: data.isAdmin,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy,
  }
  await tableUpsert(TABLE, entity)
  return { groupId, ...data, createdAt: entity.createdAt }
}

export async function deleteGroup(groupId: string): Promise<void> {
  await tableDelete(TABLE, "group", groupId)
}

export async function getAdminGroups(): Promise<Group[]> {
  const rows = await tableList<Group>(TABLE, "PartitionKey eq 'group' and isAdmin eq true")
  return rows.map(entityToGroup)
}

function entityToGroup(e: Record<string, unknown>): Group {
  return {
    groupId: e.rowKey as string,
    name: e.name as string,
    isAdmin: e.isAdmin as boolean,
    createdAt: e.createdAt as string,
    createdBy: e.createdBy as string,
  }
}
