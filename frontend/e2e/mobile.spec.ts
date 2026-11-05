import { expect, test } from "@playwright/test";

const noSideScroll = async (page: import("@playwright/test").Page) => {
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    // report what sticks out (ignoring SVG internals, which their <svg> clips)
    const out = [...document.querySelectorAll("body *")].filter((el) => !(el instanceof SVGElement && el.tagName !== "svg"))
      .map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.right > W + 1)
      .slice(0, 5).map(({ el, r }) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 50)} right=${Math.round(r.right)}`);
    return { sw: document.documentElement.scrollWidth, out, path: location.pathname };
  });
  expect(r.sw, `${r.path} overflows: ${r.out.join(" | ")}`).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
};

test("phone: bottom navigation, readable pages, no sideways scrolling", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /See where a disaster hit/ })).toBeVisible();
  await noSideScroll(page);
  const tabs = page.getByRole("navigation", { name: "Main (mobile)" });
  await expect(tabs).toBeVisible();

  await tabs.getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "To review" })).toBeVisible();
  await noSideScroll(page);

  await tabs.getByRole("link", { name: "Check" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Where should AegisEO look?" })).toBeVisible();
  await page.getByRole("tab", { name: /A past disaster/ }).click();
  await page.getByRole("button", { name: /Sindh floods, Pakistan/ }).click();
  await page.getByRole("button", { name: "Continue with this" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What happened there?" })).toBeVisible();
  await noSideScroll(page);

  await tabs.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Satellite photos that show/ })).toBeVisible();
  await noSideScroll(page);

  // body text stays comfortably large on a phone
  const size = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});
