import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aegis.onboarded", "1"));
});

test("overview renders and navigation works", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /See what changed on the ground/ })).toBeVisible();
  await expect(page.getByText("Systems online")).toBeVisible();
  for (const [link, heading] of [["Data sources", "Data sources"], ["Model & benchmarks", "Model & benchmarks"], ["How it works", "How AegisEO works"]]) {
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

test("first-visit onboarding can be completed", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Welcome to AegisEO" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: "Get started" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ctx.close();
});

test("end-to-end: run an analysis, inspect priorities and review an alert", async ({ page }) => {
  await page.goto("/analyze?scenario=synthetic-flood");
  await expect(page.getByRole("button", { name: /Synthetic river flood/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Analysis name")).toHaveValue(/Synthetic river flood/);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Run analysis" }).click();

  await expect(page).toHaveURL(/\/analyses\/[0-9a-f]{32}/);
  await expect(page.getByText("Simulated data.").first()).toBeVisible();
  await expect(page.getByText(/^Completed/).first()).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".map-card canvas").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Executive summary" })).toBeVisible();
  await expect(page.getByText(/potentially exposed/).first()).toBeVisible();

  await page.getByRole("tab", { name: /Priorities/ }).click();
  const first = page.locator("article.cell-card").first();
  await first.click();
  await expect(first.getByText("Hazard sub-score")).toBeVisible();
  await expect(first.getByText(/Suggested considerations/)).toBeVisible();

  await page.getByRole("tab", { name: /Evidence/ }).click();
  await page.getByRole("button", { name: "Guardrails" }).click();
  await expect(page.getByText("G04 Post-event observation available")).toBeVisible();

  await page.getByRole("tab", { name: /Review/ }).click();
  const alert = page.locator(".cell-card").filter({ hasText: "pending review" }).first();
  await alert.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/Alert approved - alerts derived from synthetic data can never be published/)).toBeVisible();

  const pdf = await page.request.get(page.url().replace("5173/analyses/", "5173/api/analyses/") + "/reports/pdf");
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("invalid dates are rejected before submission", async ({ page }) => {
  await page.goto("/analyze?lat=26.7&lon=67.8&hazard=flood&name=Check");
  await expect(page.getByText(/Area \d/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Event date").fill("2999-01-01");
  await expect(page.getByRole("alert")).toContainText("cannot be in the future");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});
