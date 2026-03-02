import { expect, test } from "@playwright/test";

test("placeholder e2e smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/OSSReleaseFeed/i);
});
