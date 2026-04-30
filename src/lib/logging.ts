import { getTableClient } from "@/lib/azure-tables"
import type { TableEntity } from "@azure/data-tables"

export type LogCategory =
  | "auth"
  | "crawl"
  | "serve"
  | "permission_denied"
  | "storage_error"

export type LogLevel = "info" | "warn" | "error"

export interface LogMetadata {
  userId?: string
  orgId?: string
  [key: string]: unknown
}

export function writeLog(
  category: LogCategory,
  level: LogLevel,
  message: string,
  metadata?: LogMetadata
): void {
  void (async () => {
    try {
      const now = new Date()
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, "")
      const partitionKey = `${category}#${datePart}`
      const reverseMs = (Number.MAX_SAFE_INTEGER - now.getTime())
        .toString()
        .padStart(16, "0")
      const randBytes = globalThis.crypto.getRandomValues(new Uint8Array(4))
      const rowKey = `${reverseMs}-${Buffer.from(randBytes).toString("hex")}`

      const { userId, orgId, ...rest } = metadata ?? {}
      const entity: TableEntity<Record<string, unknown>> = {
        partitionKey,
        rowKey,
        category,
        level,
        message,
        timestamp: now.toISOString(),
      }
      if (userId !== undefined) entity.userId = userId
      if (orgId !== undefined) entity.orgId = orgId
      if (Object.keys(rest).length > 0) entity.metadata = JSON.stringify(rest)

      const client = getTableClient("AuditLogs")
      await client.createEntity(entity)
    } catch (err) {
      console.error("[writeLog] failed to write audit log:", err)
    }
  })()
}
