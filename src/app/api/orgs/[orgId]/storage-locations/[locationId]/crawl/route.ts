// src/app/api/orgs/[orgId]/storage-locations/[locationId]/crawl/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { getStorageLocation } from "@/lib/storage/locations"
import { runCrawl } from "@/lib/storage/crawl"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; locationId: string }> }
) {
  const { orgId, locationId } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const location = await getStorageLocation(orgId, locationId)
  if (!location) {
    return NextResponse.json({ error: "Storage location not found" }, { status: 404 })
  }

  const result = await runCrawl(location)
  return NextResponse.json(result)
}
