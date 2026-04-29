import { NextResponse } from "next/server"
import { validateApiKey, recordTrigger } from "@/lib/identity/api-keys"
import { getOrg } from "@/lib/identity/orgs"
import { listStorageLocations } from "@/lib/storage/locations"
import { runCrawl } from "@/lib/storage/crawl"
import { writeLog } from "@/lib/logging"

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const rawKey = authHeader.slice(7)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("orgId" in body) ||
    typeof (body as { orgId: unknown }).orgId !== "string"
  ) {
    return NextResponse.json({ error: "Missing orgId" }, { status: 400 })
  }
  const orgId = (body as { orgId: string }).orgId

  const validation = await validateApiKey(orgId, rawKey)
  if (!validation.valid) {
    writeLog("permission_denied", "warn", "invalid api key", { orgId })
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (validation.cooldownRemaining !== undefined) {
    writeLog("permission_denied", "warn", "api crawl rate limited", { orgId })
    return new NextResponse(JSON.stringify({ error: "Too Many Requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(validation.cooldownRemaining),
      },
    })
  }

  const org = await getOrg(orgId)
  if (!org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 })
  }

  const locations = await listStorageLocations(orgId)
  if (locations.length === 0) {
    return NextResponse.json({ error: "No storage locations configured" }, { status: 422 })
  }

  await recordTrigger(orgId)
  writeLog("crawl", "info", "api-triggered crawl started", { orgId, locationCount: locations.length })

  void (async () => {
    for (const location of locations) {
      await runCrawl(location)
    }
  })()

  return NextResponse.json({ orgId, locationCount: locations.length }, { status: 202 })
}
