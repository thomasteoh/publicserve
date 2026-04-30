// src/middleware.ts
import { auth } from "@/auth"
import { NextResponse } from "next/server"

export function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/integrations") ||
    pathname.startsWith("/_next") ||
    pathname === "/login"
  )
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // All other routes require a session
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
