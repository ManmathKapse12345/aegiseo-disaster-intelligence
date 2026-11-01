import { expect, test } from "@playwright/test";

test("mobile navigation drawer and responsive layout", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aegis.onboarded", "1"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See what changed/ })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width + 1); // no horizontal page scroll
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Review queue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible();
});
