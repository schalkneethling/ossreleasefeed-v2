import { expect, test } from "@playwright/test";

test.describe("error boundary", () => {
  test("renders a fallback instead of a blank screen when the app crashes", async ({ page }) => {
    await page.goto("/?__throw=1");

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
  });
});
