// tests/lib/keyvault.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetSecret = vi.fn()

vi.mock("@azure/keyvault-secrets", () => {
  const mockClient = { getSecret: mockGetSecret, setSecret: vi.fn() }
  return {
    SecretClient: vi.fn(function () {
      return mockClient
    }),
  }
})

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn(),
}))

vi.mock("@/lib/logging", () => ({ writeLog: vi.fn() }))

describe("getSecret", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns parsed secret value", async () => {
    process.env.AZURE_KEYVAULT_URI = "https://kv-publicserve-nprod.vault.azure.net/"
    mockGetSecret.mockResolvedValue({ value: '{"type":"storage_key","accountKey":"abc123"}' })
    const { getSecret } = await import("@/lib/keyvault")
    const result = await getSecret("storage-cred-abc")
    expect(result).toEqual({ type: "storage_key", accountKey: "abc123" })
  })

  it("throws when AZURE_KEYVAULT_URI is missing", async () => {
    delete process.env.AZURE_KEYVAULT_URI
    vi.resetModules()
    const { getSecret } = await import("@/lib/keyvault")
    await expect(getSecret("any")).rejects.toThrow("AZURE_KEYVAULT_URI")
  })
})
