/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/auth", () => ({
  auth: vi.fn((fn: unknown) => fn),
}))
vi.mock("next/server", () => ({
  NextResponse: { next: vi.fn(() => ({})), redirect: vi.fn(() => ({})) },
}))

describe("isPublicPath", () => {
  it("allows /api/auth paths through", async () => {
    const { isPublicPath } = await import("@/middleware")
    expect(isPublicPath("/api/auth/signin")).toBe(true)
  })

  it("allows /api/integrations paths through", async () => {
    const { isPublicPath } = await import("@/middleware")
    expect(isPublicPath("/api/integrations/crawl")).toBe(true)
  })

  it("allows /_next paths through", async () => {
    const { isPublicPath } = await import("@/middleware")
    expect(isPublicPath("/_next/static/chunk.js")).toBe(true)
  })

  it("allows /login exactly", async () => {
    const { isPublicPath } = await import("@/middleware")
    expect(isPublicPath("/login")).toBe(true)
  })

  it("requires auth for /dashboard", async () => {
    const { isPublicPath } = await import("@/middleware")
    expect(isPublicPath("/dashboard")).toBe(false)
  })

  it("requires auth for /api/records serve endpoints", async () => {
    const { isPublicPath } = await import("@/middleware")
    expect(isPublicPath("/api/records/loc1/rk1/serve")).toBe(false)
  })
})
