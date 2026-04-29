// src/lib/identity/api-keys.ts
import { randomBytes, createHash } from "crypto"
import { tableGet, tableUpsert, tableDelete } from "@/lib/auth/tables"

const TABLE = "OrgApiKeys"
const COOLDOWN_MS = 60_000

export interface ApiKeyMeta {
  keyPrefix: string
  createdAt: string
  createdBy: string
  lastTriggeredAt: string | null
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex")
}

export async function generateApiKey(
  orgId: string,
  userId: string
): Promise<{ rawKey: string; keyPrefix: string; createdAt: string }> {
  const rawKey = "ps_" + randomBytes(32).toString("hex")
  const keyPrefix = rawKey.slice(0, 11)
  const createdAt = new Date().toISOString()
  await tableUpsert(TABLE, {
    partitionKey: orgId,
    rowKey: "key",
    keyHash: hashKey(rawKey),
    keyPrefix,
    createdAt,
    createdBy: userId,
    lastTriggeredAt: null,
  })
  return { rawKey, keyPrefix, createdAt }
}

export async function revokeApiKey(orgId: string): Promise<void> {
  await tableDelete(TABLE, orgId, "key")
}

export async function getApiKeyMeta(orgId: string): Promise<ApiKeyMeta | null> {
  const row = await tableGet<Record<string, unknown>>(TABLE, orgId, "key")
  if (!row) return null
  return {
    keyPrefix: row.keyPrefix as string,
    createdAt: row.createdAt as string,
    createdBy: row.createdBy as string,
    lastTriggeredAt: (row.lastTriggeredAt as string | null) ?? null,
  }
}

export async function validateApiKey(
  orgId: string,
  rawKey: string
): Promise<{ valid: boolean; cooldownRemaining?: number }> {
  const row = await tableGet<Record<string, unknown>>(TABLE, orgId, "key")
  if (!row) return { valid: false }
  if (row.keyHash !== hashKey(rawKey)) return { valid: false }

  const lastTriggered = row.lastTriggeredAt as string | null
  if (lastTriggered) {
    const elapsed = Date.now() - new Date(lastTriggered).getTime()
    if (elapsed < COOLDOWN_MS) {
      return { valid: true, cooldownRemaining: Math.ceil((COOLDOWN_MS - elapsed) / 1000) }
    }
  }
  return { valid: true }
}

export async function recordTrigger(orgId: string): Promise<void> {
  await tableUpsert(TABLE, {
    partitionKey: orgId,
    rowKey: "key",
    lastTriggeredAt: new Date().toISOString(),
  })
}
