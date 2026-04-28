// src/app/api/records/[locationId]/[recordRK]/serve/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { resolvePermissions } from "@/lib/permissions"
import { getRecord } from "@/lib/storage/records"
import { getStorageLocation } from "@/lib/storage/locations"
import { getSecret } from "@/lib/keyvault"
import { createBackend } from "@/lib/storage/factory"
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const location = await getStorageLocation(record.orgId, locationId)
  if (!location) {
    return NextResponse.json({ error: "Storage location not found" }, { status: 404 })
  }

  const creds = await getSecret<StorageCredential>(location.credentialRef)
  const backend = createBackend(location, creds)

  const signedUrl = await backend.getSignedUrl(record.path, 300)

  if (signedUrl !== null) {
    return NextResponse.redirect(signedUrl, 302)
  }

  // SFTP: proxy stream
  const stream = await backend.readStream(record.path)
  const webStream = Readable.toWeb(stream as Readable) as ReadableStream
  return new Response(webStream, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
