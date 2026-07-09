import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoSeriousViolations } from "./test-utils";

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
    await expectNoSeriousViolations(page);
  });
});

test.describe("custom topic input", () => {
  test("valid topic enables 'Add topic' and adds a tag on click", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await page.route("**/api/topics/validate*", (route) => route.fulfill({ json: true }));
    await gotoTopicStep(page);

    await page.getByLabel("Add a custom topic").fill("web-components");
    await expect(page.getByRole("button", { name: "Add topic" })).toBeEnabled({ timeout: 2000 });

    await page.getByRole("button", { name: "Add topic" }).click();

    await expect(page.getByRole("list", { name: /selected topics/i })).toContainText(
      "web-components",
    );
    await expect(page.getByLabel("Add a custom topic")).toHaveValue("");
  });

  test("Enter key adds a valid topic", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await page.route("**/api/topics/validate*", (route) => route.fulfill({ json: true }));
    await gotoTopicStep(page);

    await page.getByLabel("Add a custom topic").fill("game-dev");
    await expect(page.getByRole("button", { name: "Add topic" })).toBeEnabled({ timeout: 2000 });
    await page.getByLabel("Add a custom topic").press("Enter");

    await expect(page.getByRole("list", { name: /selected topics/i })).toContainText("game-dev");
  });

  test("invalid topic shows an error message", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await page.route("**/api/topics/validate*", (route) => route.fulfill({ json: false }));
    await gotoTopicStep(page);

    await page.getByLabel("Add a custom topic").fill("not-a-real-topic-xyz");
    await expect(page.getByText(/no github topic found matching/i)).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole("button", { name: "Add topic" })).toBeDisabled();
  });

  test("duplicate topic shows a duplicate error", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await page.route("**/api/topics/validate*", (route) => route.fulfill({ json: true }));
    await gotoTopicStep(page);

    // Add a topic first
    await page.getByLabel("Add a custom topic").fill("clojure");
    await page.getByRole("button", { name: "Add topic" }).click({ timeout: 2000 });

    // Type the same topic again
    await page.getByLabel("Add a custom topic").fill("clojure");
    await expect(page.getByText(/already in your selection/i)).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole("button", { name: "Add topic" })).toBeDisabled();
  });

  test("tag remove button deselects the topic", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);

    await page.getByRole("checkbox", { name: "JavaScript" }).check();
    await expect(page.getByRole("list", { name: /selected topics/i })).toContainText("javascript");

    await page.getByRole("button", { name: /remove javascript/i }).click();

    await expect(page.getByRole("list", { name: /selected topics/i })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "JavaScript" })).not.toBeChecked();
  });
});

test.describe("feed config and URL generation", () => {
  test("config section appears after at least one topic is selected", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);

    await expect(page.getByRole("button", { name: /generate feed url/i })).toHaveCount(0);

    await page.getByRole("checkbox", { name: "TypeScript" }).check();

    await expect(page.getByRole("button", { name: /generate feed url/i })).toBeVisible();
  });

  test("generates a feed URL containing /feed/", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);

    await page.getByRole("checkbox", { name: "React" }).check();
    await page.getByRole("button", { name: /generate feed url/i }).click();

    const link = page.getByRole("link", { name: /\/feed\//i });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/\/feed\/.+/);
  });

  test("copy button changes label to 'Copied!' then reverts", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);

    await page.getByRole("checkbox", { name: "React" }).check();
    await page.getByRole("button", { name: /generate feed url/i }).click();
    await page.getByRole("button", { name: /copy url/i }).click();

    await expect(page.getByRole("button", { name: /copied!/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /copy url/i })).toBeVisible({
      timeout: 3000,
    });
  });

  test("changing selection clears the generated URL", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await gotoTopicStep(page);

    await page.getByRole("checkbox", { name: "React" }).check();
    await page.getByRole("button", { name: /generate feed url/i }).click();
    await expect(page.getByRole("link", { name: /\/feed\//i })).toBeVisible();

    await page.getByRole("checkbox", { name: "JavaScript" }).check();
    await expect(page.getByRole("link", { name: /\/feed\//i })).toHaveCount(0);
  });

  test("full topic flow has no critical or serious axe violations", async ({ page }) => {
    await page.route("**/api/topics/featured", fulfillTopics);
    await page.route("**/api/topics/validate*", (route) => route.fulfill({ json: true }));
    await gotoTopicStep(page);

    await page.getByRole("checkbox", { name: "TypeScript" }).check();
    await page.getByRole("button", { name: /generate feed url/i }).click();
    await expectNoSeriousViolations(page);
  });
});
