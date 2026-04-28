import { getTableClient } from "@/lib/azure-tables"
import type { LogCategory } from "@/lib/logging"
import type { LogEntry } from "@/types/logging"

const ALL_CATEGORIES: LogCategory[] = [
  "auth",
  "crawl",
  "serve",
  "permission_denied",
  "storage_error",
]

const PAGE_SIZE = 50

function dateRange(
  from: string | null | undefined,
  to: string | null | undefined
): string[] {
  const startDate = from
    ? new Date(from)
    : (() => {
        const d = new Date()
        d.setDate(d.getDate() - 6)
        return d
      })()
  const endDate = to ? new Date(to) : new Date()
  const dates: string[] = []
  const cur = new Date(endDate)
  while (cur >= startDate) {
    dates.push(cur.toISOString().slice(0, 10).replace(/-/g, ""))
    cur.setDate(cur.getDate() - 1)
  }
  return dates
}

export interface QueryLogsParams {
  category?: string | null
  from?: string | null
  to?: string | null
  cursor?: string | null
}

export interface QueryLogsResult {
  entries: LogEntry[]
  nextCursor: string | null
}

export async function queryLogs(
  params: QueryLogsParams
): Promise<QueryLogsResult> {
  const { category, from, to, cursor } = params
  const categories = category
    ? [category as LogCategory]
    : ALL_CATEGORIES
  const dates = dateRange(from, to)
  const client = getTableClient("AuditLogs")
  const entries: LogEntry[] = []

  outer: for (const date of dates) {
    for (const cat of categories) {
      const partitionKey = `${cat}#${date}`
      let filter = `PartitionKey eq '${partitionKey}'`
      if (cursor) filter += ` and RowKey gt '${cursor}'`

      for await (const entity of client.listEntities<Record<string, unknown>>({
        queryOptions: { filter },
      })) {
        entries.push({
          rowKey: entity.rowKey as string,
          category: entity.category as LogCategory,
          level: entity.level as string,
          message: entity.message as string,
          timestamp: entity.timestamp as string,
          userId: entity.userId as string | undefined,
          orgId: entity.orgId as string | undefined,
          metadata: entity.metadata as string | undefined,
        })
        if (entries.length >= PAGE_SIZE) break outer
      }
    }
  }

  const nextCursor =
    entries.length === PAGE_SIZE ? entries[entries.length - 1].rowKey : null
  return { entries, nextCursor }
}
