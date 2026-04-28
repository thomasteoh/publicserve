// src/types/identity.ts
export interface Group {
  groupId: string
  name: string
  isAdmin: boolean
  createdAt: string
  createdBy: string
}

export interface UserGroup {
  userId: string
  groupId: string
  addedAt: string
  addedBy: string
}

export interface Org {
  orgId: string
  name: string
  createdAt: string
  createdBy: string
}

export interface OrgGroup {
  orgId: string
  groupId: string
  canRead: boolean
  canWrite: boolean
  canManageUsers: boolean
  canConfigureIntegrations: boolean
}

export interface EffectivePermissions {
  isAdmin: boolean
  canRead: boolean
  canWrite: boolean
  canManageUsers: boolean
  canConfigureIntegrations: boolean
}
