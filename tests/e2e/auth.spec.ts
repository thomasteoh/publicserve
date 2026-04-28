import { test, expect } from "@playwright/test"

test("sign-in page loads", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})

test("unauthenticated redirect to login", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/login/)
})
