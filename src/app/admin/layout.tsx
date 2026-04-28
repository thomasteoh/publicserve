import { redirect } from "next/navigation"
import Link from "next/link"
import type { ReactNode } from "react"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin")
  }

  const perms = await resolvePermissions(session.user.id)
  if (!perms.isAdmin) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>403 Forbidden</h1>
        <p>You do not have admin access.</p>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav
        style={{
          width: 200,
          padding: "1rem",
          borderRight: "1px solid #ccc",
          flexShrink: 0,
        }}
      >
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li style={{ marginBottom: "0.5rem" }}>
            <Link href="/admin">Dashboard</Link>
          </li>
          <li>
            <Link href="/admin/logs">Logs</Link>
          </li>
        </ul>
      </nav>
      <main style={{ flex: 1, padding: "1rem" }}>{children}</main>
    </div>
  )
}
