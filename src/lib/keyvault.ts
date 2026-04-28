// src/lib/keyvault.ts
import { SecretClient } from "@azure/keyvault-secrets"
import { DefaultAzureCredential } from "@azure/identity"
import { writeLog } from "@/lib/logging"

let _client: SecretClient | null = null

function getClient(): SecretClient {
  if (_client) return _client
  const uri = process.env.AZURE_KEYVAULT_URI
  if (!uri) throw new Error("AZURE_KEYVAULT_URI is not set")
  _client = new SecretClient(uri, new DefaultAzureCredential())
  return _client
}

export async function getSecret<T = unknown>(secretName: string): Promise<T> {
  try {
    const client = getClient()
    const secret = await client.getSecret(secretName)
    if (!secret.value) throw new Error(`Secret ${secretName} has no value`)
    return JSON.parse(secret.value) as T
  } catch (err) {
    writeLog("storage_error", "error", "keyvault error", {
      secretName,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function setSecret(secretName: string, value: unknown): Promise<void> {
  const client = getClient()
  await client.setSecret(secretName, JSON.stringify(value))
}
