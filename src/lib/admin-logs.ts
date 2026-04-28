// src/lib/admin-logs.ts
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

interface ParsedCursor {
  date: string
  catIdx: number
  rowKey: string
}

function decodeCursor(cursor: string): ParsedCursor | null {
  const firstUnderscore = cursor.indexOf("_")
  if (firstUnderscore === -1) return null
  const secondUnderscore = cursor.indexOf("_", firstUnderscore + 1)
  if (secondUnderscore === -1) return null
  const date = cursor.slice(0, firstUnderscore)
  const catIdx = parseInt(cursor.slice(firstUnderscore + 1, secondUnderscore), 10)
  const rowKey = cursor.slice(secondUnderscore + 1)
  if (isNaN(catIdx) || !date || !rowKey) return null
  return { date, catIdx, rowKey }
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
  const parsedCursor = cursor ? decodeCursor(cursor) : null
  const client = getTableClient("AuditLogs")
  const entries: LogEntry[] = []
  let lastDate = ""
  let lastCatIdx = 0

  outer: for (const date of dates) {
    for (let ci = 0; ci < categories.length; ci++) {
      // Skip partitions already consumed in a prior page
      if (parsedCursor) {
        if (date > parsedCursor.date) continue
        if (date === parsedCursor.date && ci < parsedCursor.catIdx) continue
      }

      const cat = categories[ci]
      const partitionKey = `${cat}#${date}`
      let filter = `PartitionKey eq '${partitionKey}'`
      if (parsedCursor && date === parsedCursor.date && ci === parsedCursor.catIdx) {
        filter += ` and RowKey gt '${parsedCursor.rowKey}'`
      }

      for await (const entity of client.listEntities<Record<string, unknown>>({
        queryOptions: { filter },
      })) {
        lastDate = date
        lastCatIdx = ci
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
    entries.length === PAGE_SIZE
      ? `${lastDate}_${lastCatIdx}_${entries[entries.length - 1].rowKey}`
      : null
  return { entries, nextCursor }
}
