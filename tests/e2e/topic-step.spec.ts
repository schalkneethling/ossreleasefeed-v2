import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const topicsFixture = [
  { name: "javascript", display_name: "JavaScript", short_description: "A scripting language" },
  { name: "typescript", display_name: "TypeScript", short_description: "Typed JavaScript" },
  { name: "react", display_name: "React", short_description: "A UI library" },
  { name: "web-components", display_name: "Web Components", short_description: "Custom elements" },
  { name: "accessibility", display_name: null, short_description: "Inclusive interfaces" },
  { name: "rust", display_name: "Rust", short_description: "A systems language" },
];

const fulfillTopics = (route: Route) => route.fulfill({ json: topicsFixture });

const gotoTopicStep = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create feed" }).click();
  await page.getByRole("button", { name: /feed by topic/i }).click();
};

test.describe("featured topics grid", () => {
  test("shows a loading state while topics are fetched", async ({ page }) => {
    await page.route("**/api/topics/featured", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await fulfillTopics(route);
    });
    await gotoTopicStep(page);

    await expect(page.getByRole("status")).toContainText(/loading featured topics/i);
    await expect(page.getByRole("checkbox")).toHaveCount(topicsFixture.length);
  });

  test("renders one labelled checkbox per topic", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);

    await expect(page.getByRole("checkbox")).toHaveCount(topicsFixture.length);
    await expect(page.getByRole("checkbox", { name: "JavaScript" })).toBeVisible();
    // display_name null falls back to the slug
    await expect(page.getByRole("checkbox", { name: "accessibility" })).toBeVisible();
  });

  test("shows an inline error with retry when the request fails", async ({ page }) => {
    let requests = 0;

    await page.route("**/api/topics/featured", async (route) => {
      requests += 1;

      if (requests === 1) {
        await route.fulfill({ status: 503, json: { error: "GitHub temporarily unavailable" } });
        return;
      }

      await fulfillTopics(route);
    });
    await gotoTopicStep(page);

    await expect(page.getByRole("alert")).toContainText(/could not load featured topics/i);

    await page.getByRole("button", { name: /try again/i }).click();

    await expect(page.getByRole("checkbox")).toHaveCount(topicsFixture.length);
  });

  test("disables unchecked topics at the limit and announces it", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);

    const names = ["JavaScript", "TypeScript", "React", "Web Components", "accessibility"];

    for (const name of names) {
      await page.getByRole("checkbox", { name }).check();
    }

    const sixth = page.getByRole("checkbox", { name: "Rust" });

    await expect(sixth).toBeDisabled();
    await expect(page.getByText(/topic limit reached/i)).toBeVisible();

    await page.getByRole("checkbox", { name: "JavaScript" }).uncheck();

    await expect(sixth).toBeEnabled();
    await expect(page.getByText(/topic limit reached/i)).toHaveCount(0);

    // checked topics stay interactive at the limit
    for (const name of names.slice(1)) {
      await expect(page.getByRole("checkbox", { name })).toBeEnabled();
    }
  });

  test("topic grid has no critical or serious axe violations", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);
    await expect(page.getByRole("checkbox")).toHaveCount(topicsFixture.length);
    await page.evaluate(() =>
      Promise.all(
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
