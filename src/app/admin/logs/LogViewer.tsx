"use client"

import { Fragment, useState } from "react"
import type { LogEntry } from "@/types/logging"

interface Props {
  initialEntries: LogEntry[]
  initialNextCursor: string | null
  category?: string
  from?: string
  to?: string
}

export default function LogViewer({
  initialEntries,
  initialNextCursor,
  category,
  from,
  to,
}: Props) {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  async function loadMore() {
    if (!nextCursor) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (category) qs.set("category", category)
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    qs.set("cursor", nextCursor)
    const res = await fetch(`/api/admin/logs?${qs}`)
    const data: { entries: LogEntry[]; nextCursor: string | null } =
      await res.json()
    setEntries((prev) => [...prev, ...data.entries])
    setNextCursor(data.nextCursor)
    setLoading(false)
  }

  function toggleRow(rowKey: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Timestamp</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Category</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Level</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Message</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>User</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Org</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Fragment key={entry.rowKey}>
              <tr style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}>
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
                <td style={{ padding: "0.5rem" }}>{entry.category}</td>
                <td style={{ padding: "0.5rem" }}>{entry.level}</td>
                <td style={{ padding: "0.5rem" }}>{entry.message}</td>
                <td style={{ padding: "0.5rem" }}>{entry.userId ?? ""}</td>
                <td style={{ padding: "0.5rem" }}>{entry.orgId ?? ""}</td>
                <td style={{ padding: "0.5rem" }}>
                  {entry.metadata && (
                    <button onClick={() => toggleRow(entry.rowKey)}>
                      {expandedRows.has(entry.rowKey) ? "Hide" : "Show"}
                    </button>
                  )}
                </td>
              </tr>
              {expandedRows.has(entry.rowKey) && entry.metadata && (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: "0.5rem", background: "#f9f9f9" }}
                  >
                    <pre style={{ margin: 0, fontSize: "0.85em" }}>
                      {JSON.stringify(JSON.parse(entry.metadata), null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {nextCursor && (
        <button
          onClick={loadMore}
          disabled={loading}
          style={{ marginTop: "1rem" }}
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  )
}
