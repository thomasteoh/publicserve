// src/lib/permissions.ts
import { getGroup } from "@/lib/identity/groups"
import { getGroupsForUser } from "@/lib/identity/user-groups"
import { getOrgGroups } from "@/lib/identity/org-groups"
import type { EffectivePermissions } from "@/types/identity"

const FULL_ACCESS: EffectivePermissions = {
  isAdmin: true,
  canRead: true,
  canWrite: true,
  canManageUsers: true,
  canConfigureIntegrations: true,
}

const NO_ACCESS: EffectivePermissions = {
  isAdmin: false,
  canRead: false,
  canWrite: false,
  canManageUsers: false,
  canConfigureIntegrations: false,
}

export async function resolvePermissions(
  userId: string,
  orgId?: string
): Promise<EffectivePermissions> {
  const groupIds = await getGroupsForUser(userId)
  if (groupIds.length === 0) return NO_ACCESS

  const groups = await Promise.all(groupIds.map((id) => getGroup(id)))
  const isAdmin = groups.some((g) => g?.isAdmin === true)
  if (isAdmin) return FULL_ACCESS

  if (!orgId) return NO_ACCESS

  const orgGroups = await getOrgGroups(orgId)
  const userOrgGroups = orgGroups.filter((og) => groupIds.includes(og.groupId))

  if (userOrgGroups.length === 0) return NO_ACCESS

  return {
    isAdmin: false,
    canRead: userOrgGroups.some((g) => g.canRead),
    canWrite: userOrgGroups.some((g) => g.canWrite),
    canManageUsers: userOrgGroups.some((g) => g.canManageUsers),
    canConfigureIntegrations: userOrgGroups.some((g) => g.canConfigureIntegrations),
  }
}
