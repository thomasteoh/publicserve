// src/lib/azure-tables.ts
import { TableServiceClient, TableClient } from "@azure/data-tables"

let _client: TableServiceClient | null = null
const _tableClients = new Map<string, TableClient>()

export function getTableServiceClient(): TableServiceClient {
  if (_client) return _client
  const connStr = process.env.AZURE_TABLES_CONNECTION_STRING
  if (!connStr) throw new Error("AZURE_TABLES_CONNECTION_STRING is not set")
  _client = TableServiceClient.fromConnectionString(connStr)
  return _client
}

export function getTableClient(tableName: string): TableClient {
  const cached = _tableClients.get(tableName)
  if (cached) return cached
  const connStr = process.env.AZURE_TABLES_CONNECTION_STRING
  if (!connStr) throw new Error("AZURE_TABLES_CONNECTION_STRING is not set")
  const client = TableClient.fromConnectionString(connStr, tableName)
  _tableClients.set(tableName, client)
  return client
}
