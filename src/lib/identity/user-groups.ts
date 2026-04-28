// src/lib/identity/user-groups.ts
import { tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { UserGroup } from "@/types/identity"

const TABLE = "UserGroups"

export async function addUserToGroup(
  userId: string,
  groupId: string,
  addedBy: string
): Promise<void> {
  await tableUpsert(TABLE, {
    partitionKey: userId,
    rowKey: groupId,
    addedAt: new Date().toISOString(),
    addedBy,
  })
}

export async function removeUserFromGroup(userId: string, groupId: string): Promise<void> {
  await tableDelete(TABLE, userId, groupId)
}

export async function getGroupsForUser(userId: string): Promise<string[]> {
  const rows = await tableList<UserGroup>(TABLE, `PartitionKey eq '${userId}'`)
  return rows.map((r) => r.rowKey as unknown as string)
}

export async function getUsersInGroup(groupId: string): Promise<string[]> {
  // Note: this is a cross-partition scan — acceptable for low-volume admin ops
  const rows = await tableList<UserGroup>(TABLE, `RowKey eq '${groupId}'`)
  return rows.map((r) => r.partitionKey as unknown as string)
}
