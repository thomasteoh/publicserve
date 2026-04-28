import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { queryLogs } from "@/lib/admin-logs"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const perms = await resolvePermissions(session.user.id)
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const result = await queryLogs({
    category: url.searchParams.get("category"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    cursor: url.searchParams.get("cursor"),
  })

  return NextResponse.json(result)
}
