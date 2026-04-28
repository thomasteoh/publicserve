import type { LogCategory } from "@/lib/logging"

export interface LogEntry {
  rowKey: string
  category: LogCategory
  level: string
  message: string
  timestamp: string
  userId?: string
  orgId?: string
  metadata?: string
}
