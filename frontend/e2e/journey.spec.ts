import { expect, test } from "@playwright/test";

const main = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main", exact: true });

test("home explains what this is and offers clear choices, with no pop-up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /See where a disaster hit/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); // guidance is built in, not a modal tour
  for (const choice of ["Check a place", "Explore a past disaster", "Look at disasters happening now", "Try a practice run"]) {
    await expect(page.getByRole("heading", { level: 3, name: choice })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "How it works, in four pictures" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible();

  for (const [link, heading] of [["Results", "Results"], ["To review", "To review"], ["About", /Satellite photos that show/]] as const) {
    await main(page).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await page.getByRole("link", { name: "All test results" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How accurate is it?" })).toBeVisible();
  await page.goto("/about/data");
  await expect(page.getByRole("heading", { level: 1, name: "Where the data comes from" })).toBeVisible();
  await expect(page.getByText("OpenStreetMap Nominatim (place search)")).toBeVisible({ timeout: 60_000 });
});

test("old addresses still work", async ({ page }) => {
  for (const [from, to] of [["/analyses", /\/results$/], ["/model", /\/about\/accuracy$/], ["/methodology", /\/about$/], ["/sources", /\/about\/data$/]] as const) {
    await page.goto(from);
    await expect(page).toHaveURL(to);
  }
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
});

test("the wizard guides a real check step by step, and lets you go back", async ({ page }) => {
  await page.goto("/check?start=past");
  await expect(page.getByRole("heading", { level: 1, name: "Where should AegisEO look?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await expect(page.getByText("Choose a place to continue.")).toBeVisible();

  await page.getByRole("button", { name: /Sindh floods, Pakistan/ }).click();
  await expect(page.getByText("Chosen: Sindh floods, Pakistan (2022)")).toBeVisible();
  await page.getByRole("button", { name: "Continue with this" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "What happened there?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Flood/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Already chosen for you: Flood")).toBeVisible();
  await page.getByRole("button", { name: /^Wildfire/ }).click();
  await expect(page.getByText("The event you picked was a flood")).toBeVisible();
  await page.getByRole("button", { name: /^Flood/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "When did it happen?" })).toBeVisible();
  await expect(page.getByLabel("When did it happen?")).toHaveValue("2022-08-26");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Ready to start" })).toBeVisible();
  await expect(page.locator(".summary-sentence")).toContainText("flooding");
  await expect(page.locator(".summary-sentence")).toContainText("Dadu district");
  await expect(page.getByLabel("Name")).toHaveValue("Sindh floods, Pakistan (2022)");

  // go back with the progress steps and with the guide's "Change" link
  await page.getByRole("button", { name: /Step 2: What/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What happened there?" })).toBeVisible();
  await page.getByRole("complementary", { name: "Guide" }).getByRole("button", { name: "Change" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Where should AegisEO look?" })).toBeVisible();
});

test("impossible dates are explained and block continuing", async ({ page }) => {
  await page.goto("/check?lat=26.7&lon=67.8&hazard=flood&name=Check");
  await expect(page.getByText(/Your area:/)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("When did it happen?").fill("2999-01-01");
  await expect(page.getByRole("alert").filter({ hasText: "can't be in the future" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
});

test("typed coordinates find a place and the frame chooses the area", async ({ page }) => {
  await page.goto("/check?start=map");
  await page.getByLabel("Search for a place").fill("26.7, 67.8");
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("option", { name: /26.7000, 67.8000/ }).click();
  await expect(page.getByText(/Inside the frame:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this area" })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "Use this area" }).click();
  await expect(page.getByText(/Your area:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
});

test("end to end: a practice run, its short answer, priorities, evidence and a review decision", async ({ page }) => {
  await page.goto("/check?scenario=synthetic-flood");
  await expect(page.getByRole("heading", { level: 1, name: "Ready to start" })).toBeVisible();
  await expect(page.getByText("Practice run", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start the check" }).click();

  await expect(page).toHaveURL(/\/results\/[0-9a-f]{32}/);
  await expect(page.getByText("Practice run with made-up data")).toBeVisible();
  await expect(page.getByText("The short answer")).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".summary-sentence")).toContainText(/looks newly flooded|No flooding was found/);
  await expect(page.locator(".map-card canvas").first()).toBeVisible();

  // where to help first: open the top square and see the reasons
  const first = page.locator("article.square-card").first();
  await first.locator("button[aria-expanded]").click();
  await expect(first.getByText(/Why it scored/)).toBeVisible();
  await expect(first.getByText("Suggested next steps")).toBeVisible();

  // how we know: plain safety checks, with the full record one click away
  await page.getByRole("tab", { name: /How we know/ }).click();
  await expect(page.getByRole("heading", { name: "Safety checks" })).toBeVisible();
  await page.getByText("Full step-by-step record (for specialists)").click();
  await page.getByRole("button", { name: "Safety checks", exact: true }).click();
  await expect(page.getByText(/G04 /).first()).toBeVisible();

  // needs your OK: approve a draft warning - practice warnings are never sent
  await page.getByRole("tab", { name: /Needs your OK/ }).click();
  const warning = page.locator("article.review-card").filter({ hasText: "Waiting for approval" }).first();
  const readFirst = warning.getByRole("button", { name: "Read and decide" });
  if (await readFirst.isVisible()) await readFirst.click();
  await warning.getByRole("button", { name: /Approve/ }).click();
  await expect(page.getByText(/Approved\..*never be published/)).toBeVisible();

  const pdf = await page.request.get(page.url().replace("/results/", "/api/analyses/") + "/reports/pdf");
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});
