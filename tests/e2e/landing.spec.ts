import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test("renders the landing state", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/OSSReleaseFeed/i);
    await expect(
      page.getByRole("heading", { level: 1, name: /follow open source releases/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create feed" })).toBeVisible();
  });

  test("create feed button is keyboard reachable", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    await expect(page.getByRole("button", { name: "Create feed" })).toBeFocused();
  });

  test("mode selection stays hidden until create feed is clicked", async ({ page }) => {
    await page.goto("/");

    const builder = page.getByRole("region", { name: /how do you want to build your feed/i });

    await expect(builder).toHaveCount(0);

    await page.getByRole("button", { name: "Create feed" }).click();

    await expect(builder).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /how do you want to build your feed/i }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Create feed" })).toHaveCount(0);
  });

  test("landing page has no critical or serious axe violations", async ({ page }) => {
    await page.goto("/");

    const results = await new AxeBuilder({ page }).analyze();
    const severe = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );

    expect(severe).toEqual([]);
  });

  test("builder state has no critical or serious axe violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create feed" }).click();

    // Let the reveal animation finish — axe samples computed colors, and
    // mid-fade opacity reads as a contrast failure.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.finished)),
    );

    const results = await new AxeBuilder({ page }).analyze();
    const severe = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );

    expect(severe).toEqual([]);
  });
});
