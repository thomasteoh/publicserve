// src/lib/identity/org-groups.ts
import { tableUpsert, tableList, tableDelete } from "@/lib/auth/tables"
import type { OrgGroup } from "@/types/identity"

const TABLE = "OrgGroups"

export async function setOrgGroupPermissions(data: OrgGroup): Promise<void> {
  await tableUpsert(TABLE, {
    partitionKey: data.orgId,
    rowKey: data.groupId,
    canRead: data.canRead,
    canWrite: data.canWrite,
    canManageUsers: data.canManageUsers,
    canConfigureIntegrations: data.canConfigureIntegrations,
  })
}

export async function removeGroupFromOrg(orgId: string, groupId: string): Promise<void> {
  await tableDelete(TABLE, orgId, groupId)
}

export async function getOrgGroups(orgId: string): Promise<OrgGroup[]> {
  const rows = await tableList<OrgGroup>(TABLE, `PartitionKey eq '${orgId}'`)
  return rows.map((e) => ({
    orgId,
    groupId: e.rowKey as unknown as string,
    canRead: e.canRead as boolean,
    canWrite: e.canWrite as boolean,
    canManageUsers: e.canManageUsers as boolean,
    canConfigureIntegrations: e.canConfigureIntegrations as boolean,
  }))
}
