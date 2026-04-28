import { queryLogs } from "@/lib/admin-logs"
import LogViewer from "./LogViewer"
import type { LogCategory } from "@/lib/logging"

const CATEGORIES: LogCategory[] = [
  "auth",
  "crawl",
  "serve",
  "permission_denied",
  "storage_error",
]

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string
    from?: string
    to?: string
  }>
}) {
  const params = await searchParams
  const { entries, nextCursor } = await queryLogs({
    category: params.category,
    from: params.from,
    to: params.to,
  })

  return (
    <div>
      <h1>Logs</h1>
      <form method="GET" action="/admin/logs" style={{ marginBottom: "1rem" }}>
        <label style={{ marginRight: "1rem" }}>
          Category:{" "}
          <select name="category" defaultValue={params.category ?? ""}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ marginRight: "1rem" }}>
          From:{" "}
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
          />
        </label>
        <label style={{ marginRight: "1rem" }}>
          To:{" "}
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
          />
        </label>
        <button type="submit">Filter</button>
      </form>
      <LogViewer
        initialEntries={entries}
        initialNextCursor={nextCursor}
        category={params.category}
        from={params.from}
        to={params.to}
      />
    </div>
  )
}
