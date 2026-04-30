// src/app/api/records/[locationId]/[recordRK]/serve/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { getRecord } from "@/lib/storage/records"
import { getStorageLocation } from "@/lib/storage/locations"
import { getSecret } from "@/lib/keyvault"
import { createBackend } from "@/lib/storage/factory"
import { writeLog } from "@/lib/logging"
import type { StorageCredential } from "@/lib/storage/types"
import { Readable } from "stream"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locationId: string; recordRK: string }> }
) {
  const { locationId, recordRK } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const record = await getRecord(locationId, recordRK)
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const perms = await resolvePermissions(session.user.id, record.orgId)
  if (!perms.isAdmin && !perms.canRead) {
    writeLog("permission_denied", "warn", "permission denied: serve", {
      userId: session.user.id,
      locationId,
      recordRK,
    })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (record.stale) {
    writeLog("serve", "warn", "attempt to serve stale record", {
      userId: session.user.id,
      orgId: record.orgId,
      locationId,
      recordRK,
    })
    return NextResponse.json({ error: "Record is stale" }, { status: 410 })
  }

  const location = await getStorageLocation(record.orgId, locationId)
  if (!location) {
    return NextResponse.json({ error: "Storage location not found" }, { status: 404 })
  }

  try {
    const creds = await getSecret<StorageCredential>(location.credentialRef)
    const backend = createBackend(location, creds)
    const signedUrl = await backend.getSignedUrl(record.path, 300)

    if (signedUrl !== null) {
      writeLog("serve", "info", "record served via redirect", {
        userId: session.user.id,
        orgId: record.orgId,
        locationId,
        recordRK,
      })
      return NextResponse.redirect(signedUrl, 302)
    }

    writeLog("serve", "info", "record served via sftp proxy", {
      userId: session.user.id,
      orgId: record.orgId,
      locationId,
      recordRK,
    })
    const stream = await backend.readStream(record.path)
    const webStream = Readable.toWeb(stream as Readable) as ReadableStream
    return new Response(webStream, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (err) {
    writeLog("storage_error", "error", "storage error during serve", {
      userId: session.user.id,
      locationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Storage error" }, { status: 500 })
  }
}
