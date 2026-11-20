import { test, expect } from "@playwright/test";

test("LumenBalance story screenshot", async ({ page }) => {
  await page.goto("/iframe.html?id=components-lumenbalance--default&viewMode=story");
  await expect(page).toHaveScreenshot("lumen-balance.png");
});