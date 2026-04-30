// tests/lib/azure-tables.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { TableClient } from "@azure/data-tables"

vi.mock("@azure/data-tables", () => ({
  TableServiceClient: {
    fromConnectionString: vi.fn(() => ({ name: "mock-service" })),
  },
  TableClient: {
    fromConnectionString: vi.fn((_, tableName: string) => ({ _tableName: tableName })),
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

describe("getTableClient caching", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.mocked(TableClient.fromConnectionString).mockImplementation(
      (_, tableName: string) => ({ _tableName: tableName } as never)
    )
    process.env.AZURE_TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true"
  })

  it("returns the same TableClient instance for repeated calls with the same table name", async () => {
    const { getTableClient } = await import("@/lib/azure-tables")
    const c1 = getTableClient("AuditLogs")
    const c2 = getTableClient("AuditLogs")
    expect(c1).toBe(c2)
    expect(TableClient.fromConnectionString).toHaveBeenCalledTimes(1)
  })

  it("returns distinct TableClient instances for different table names", async () => {
    const { getTableClient } = await import("@/lib/azure-tables")
    const c1 = getTableClient("Users")
    const c2 = getTableClient("Sessions")
    expect(c1).not.toBe(c2)
  })

  it("throws when connection string is missing", async () => {
    delete process.env.AZURE_TABLES_CONNECTION_STRING
    const { getTableClient } = await import("@/lib/azure-tables")
    expect(() => getTableClient("AnyTable")).toThrow("AZURE_TABLES_CONNECTION_STRING")
  })
})
