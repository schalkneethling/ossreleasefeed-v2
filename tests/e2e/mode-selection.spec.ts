import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const startBuilder = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create feed" }).click();
};

test.describe("mode selection", () => {
  test("shows both mode cards as buttons after starting", async ({ page }) => {
    await startBuilder(page);

    await expect(page.getByRole("button", { name: /feed by topic/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /feed by stars/i })).toBeVisible();
  });

  test("cards are keyboard navigable from the builder heading", async ({ page }) => {
    await startBuilder(page);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /feed by topic/i })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /feed by stars/i })).toBeFocused();
  });

  test("selecting feed by topic reveals the topic step", async ({ page }) => {
    await startBuilder(page);
    await page.getByRole("button", { name: /feed by topic/i }).click();

    await expect(page.getByRole("button", { name: /feed by topic/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("region", { name: /choose your topics/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /choose your topics/i }),
    ).toBeFocused();
    await expect(page.getByRole("region", { name: /starred repositories/i })).toHaveCount(0);
  });

  test("selecting feed by stars reveals the starred step", async ({ page }) => {
    await startBuilder(page);
    await page.getByRole("button", { name: /feed by stars/i }).click();

    await expect(page.getByRole("button", { name: /feed by stars/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("region", { name: /starred repositories/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /starred repositories/i }),
    ).toBeFocused();
    await expect(page.getByRole("region", { name: /choose your topics/i })).toHaveCount(0);
  });

  test("switching modes swaps the revealed step", async ({ page }) => {
    await startBuilder(page);
    await page.getByRole("button", { name: /feed by topic/i }).click();
    await page.getByRole("button", { name: /feed by stars/i }).click();

    await expect(page.getByRole("region", { name: /choose your topics/i })).toHaveCount(0);
    await expect(page.getByRole("region", { name: /starred repositories/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /feed by topic/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByRole("button", { name: /feed by stars/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("mode selected state has no critical or serious axe violations", async ({ page }) => {
    await startBuilder(page);
    await page.getByRole("button", { name: /feed by topic/i }).click();
    await page.evaluate(() =>
      Promise.all(
        // Cancelled animations (e.g. superseded transitions) reject their
        // finished promise — treat those as settled.
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      ),
    );

    const results = await new AxeBuilder({ page }).analyze();
    const severe = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );

    expect(severe).toEqual([]);
  });
});
