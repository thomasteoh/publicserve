import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { generateApiKey, revokeApiKey, getApiKeyMeta } from "@/lib/identity/api-keys"
import { writeLog } from "@/lib/logging"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return NextResponse.json(await getApiKeyMeta(orgId))
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const existing = await getApiKeyMeta(orgId)
  const result = await generateApiKey(orgId, session.user.id)
  writeLog(
    "auth",
    existing ? "warn" : "info",
    existing ? "api key rotated" : "api key generated",
    { orgId, userId: session.user.id }
  )
  return NextResponse.json(result, { status: 201 })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const perms = await resolvePermissions(session.user.id, orgId)
  if (!perms.isAdmin && !perms.canConfigureIntegrations) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  await revokeApiKey(orgId)
  writeLog("auth", "warn", "api key revoked", { orgId, userId: session.user.id })
  return new NextResponse(null, { status: 204 })
}
