// src/lib/auth/adapter.ts
import type { Adapter, AdapterUser, AdapterSession, AdapterAccount, VerificationToken } from "next-auth/adapters"
import { randomUUID } from "crypto"
import { tableGet, tableUpsert, tableDelete, tableList } from "@/lib/auth/tables"

export function AzureTablesAdapter(): Adapter {
  return {
    async createUser(data) {
      const id = randomUUID()
      const entity = {
        partitionKey: "user",
        rowKey: id,
        email: data.email,
        emailVerified: data.emailVerified?.toISOString() ?? null,
        name: data.name ?? null,
        image: data.image ?? null,
        createdAt: new Date().toISOString(),
      }
      await tableUpsert("Users", entity)
      return {
        id,
        email: data.email,
        emailVerified: data.emailVerified ?? null,
        name: data.name ?? null,
        image: data.image ?? null,
      }
    },

    async getUser(id) {
      const entity = await tableGet("Users", "user", id)
      if (!entity) return null
      return entityToUser(entity)
    },

    async getUserByEmail(email) {
      const results = await tableList<Record<string, unknown>>(
        "Users",
        `PartitionKey eq 'user' and email eq '${email}'`
      )
      if (results.length === 0) return null
      return entityToUser(results[0])
    },

    async getUserByAccount({ providerAccountId, provider }) {
      const pk = `account_${provider}_${providerAccountId}`
      const results = await tableList<{ rowKey: string }>(
        "Accounts",
        `PartitionKey eq '${pk}'`
      )
      if (results.length === 0) return null
      const userId = results[0].rowKey
      const userEntity = await tableGet("Users", "user", userId)
      if (!userEntity) return null
      return entityToUser(userEntity)
    },

    async updateUser(data) {
      const existing = await tableGet<Record<string, unknown>>("Users", "user", data.id)
      if (!existing) throw new Error(`User ${data.id} not found`)
      await tableUpsert("Users", {
        ...existing,
        ...omitUndefined({
          name: data.name,
          image: data.image,
          emailVerified: data.emailVerified?.toISOString() ?? null,
        }),
      })
      return { ...entityToUser(existing), ...data }
    },

    async deleteUser(id) {
      await tableDelete("Users", "user", id)
    },

    async linkAccount(data) {
      const pk = `account_${data.provider}_${data.providerAccountId}`
      await tableUpsert("Accounts", {
        partitionKey: pk,
        rowKey: data.userId,
        type: data.type,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
      })
      return data as AdapterAccount
    },

    async unlinkAccount({ providerAccountId, provider }) {
      const pk = `account_${provider}_${providerAccountId}`
      const results = await tableList<{ rowKey: string }>("Accounts", `PartitionKey eq '${pk}'`)
      for (const r of results) await tableDelete("Accounts", pk, r.rowKey)
    },

    async createSession(data) {
      await tableUpsert("Sessions", {
        partitionKey: "session",
        rowKey: data.sessionToken,
        userId: data.userId,
        expires: data.expires.toISOString(),
      })
      return data
    },

    async getSessionAndUser(sessionToken) {
      const session = await tableGet<{ userId: string; expires: string }>(
        "Sessions", "session", sessionToken
      )
      if (!session) return null
      const userEntity = await tableGet("Users", "user", session.userId)
      if (!userEntity) return null
      return {
        session: {
          sessionToken,
          userId: session.userId,
          expires: new Date(session.expires),
        },
        user: entityToUser(userEntity),
      }
    },

    async updateSession(data) {
      const existing = await tableGet<{ userId: string; expires: string }>(
        "Sessions", "session", data.sessionToken
      )
      if (!existing) return null
      const updated = {
        ...existing,
        expires: (data.expires ?? new Date(existing.expires)).toISOString(),
      }
      await tableUpsert("Sessions", updated)
      return { sessionToken: data.sessionToken, userId: existing.userId, expires: new Date(updated.expires) }
    },

    async deleteSession(sessionToken) {
      await tableDelete("Sessions", "session", sessionToken)
    },

    async createVerificationToken(data) {
      await tableUpsert("VerificationTokens", {
        partitionKey: "verificationToken",
        rowKey: `${data.identifier}_${data.token}`,
        expires: data.expires.toISOString(),
      })
      return data
    },

    async useVerificationToken({ identifier, token }) {
      const rk = `${identifier}_${token}`
      const entity = await tableGet<{ expires: string }>("VerificationTokens", "verificationToken", rk)
      if (!entity) return null
      await tableDelete("VerificationTokens", "verificationToken", rk)
      return { identifier, token, expires: new Date(entity.expires) }
    },
  }
}

function entityToUser(entity: Record<string, unknown>): AdapterUser {
  return {
    id: entity.rowKey as string,
    email: entity.email as string,
    emailVerified: entity.emailVerified ? new Date(entity.emailVerified as string) : null,
    name: (entity.name as string | null) ?? null,
    image: (entity.image as string | null) ?? null,
  }
}

function omitUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>
}
