// src/lib/identity/bootstrap.ts
import { createGroup, getAdminGroups } from "@/lib/identity/groups"
import { addUserToGroup, getUsersInGroup } from "@/lib/identity/user-groups"

const ADMIN_GROUP_NAME = "admin"

/** Ensure admin group exists. Returns its groupId. */
export async function ensureAdminGroup(): Promise<string> {
  const adminGroups = await getAdminGroups()
  if (adminGroups.length > 0) return adminGroups[0].groupId
  const group = await createGroup({ name: ADMIN_GROUP_NAME, isAdmin: true, createdBy: "system" })
  return group.groupId
}

/** Called from next-auth createUser event. Elevates user to admin if admin group has no members. */
export async function bootstrapFirstAdmin(userId: string): Promise<void> {
  const adminGroupId = await ensureAdminGroup()
  const members = await getUsersInGroup(adminGroupId)
  if (members.length === 0) {
    await addUserToGroup(userId, adminGroupId, "system")
  }
}
