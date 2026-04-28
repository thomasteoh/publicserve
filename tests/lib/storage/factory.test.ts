// tests/lib/storage/factory.test.ts
import { describe, it, expect } from "vitest"

describe("createBackend", () => {
  it("throws for unknown type", async () => {
    const { createBackend } = await import("@/lib/storage/factory")
    const loc = { type: "unknown" } as never
    const creds = {} as never
    expect(() => createBackend(loc, creds)).toThrow("Unknown storage type")
  })
})
