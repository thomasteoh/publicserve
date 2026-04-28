// tests/lib/azure-tables.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@azure/data-tables", () => ({
  TableServiceClient: {
    fromConnectionString: vi.fn(() => ({ name: "mock-service" })),
  },
}))

describe("getTableServiceClient", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns a TableServiceClient from connection string", async () => {
    process.env.AZURE_TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true"
    const { getTableServiceClient } = await import("@/lib/azure-tables")
    const client = getTableServiceClient()
    expect(client).toBeDefined()
  })

  it("throws when connection string is missing", async () => {
    delete process.env.AZURE_TABLES_CONNECTION_STRING
    vi.resetModules()
    await expect(
      import("@/lib/azure-tables").then((m) => m.getTableServiceClient())
    ).rejects.toThrow("AZURE_TABLES_CONNECTION_STRING")
  })
})
