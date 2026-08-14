import { expect, test } from "@playwright/test";
import { expectNoSeriousViolations } from "./test-utils";

const experimentKeyPattern = /^[A-Za-z0-9_-]{16,128}$/u;
const topicsFixture = [
  { name: "css", display_name: "CSS", short_description: "Cascading Style Sheets" },
  { name: "javascript", display_name: "JavaScript", short_description: "A scripting language" },
  { name: "typescript", display_name: "TypeScript", short_description: "Typed JavaScript" },
];

const topicDraft = (topics: string[], ttl = 3600) => ({
  source: "topics",
  topics,
  username: null,
  repoSelection: null,
  activityType: "releases",
  ttl,
  format: "atom",
  topicOperator: "or",
});

test.describe("adaptive feed Phase 2", () => {
  let currentExperimentKey: string;

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/experiments", async (route) => {
      currentExperimentKey = route.request().headers()["x-experiment-key"];
      expect(currentExperimentKey).toMatch(experimentKeyPattern);
      await route.fulfill({ json: { adaptiveFeedBuilder: true } });
    });
    await page.route("**/api/topics/featured", (route) => route.fulfill({ json: topicsFixture }));
  });

  test("creates a topic feed from one typed request", async ({ page }) => {
    await page.route("**/api/assistant/turn", async (route) => {
      const request = route.request();
      const body = request.postDataJSON();

      expect(request.headers()["x-experiment-key"]).toBe(currentExperimentKey);
      expect(body.message).toContain("CSS, JavaScript, and TypeScript");
      await route.fulfill({
        json: {
          state: "ready",
          draft: {
            source: "topics",
            topics: ["css", "javascript", "typescript"],
            username: null,
            repoSelection: null,
            activityType: "releases",
            ttl: 86400,
            format: "atom",
            topicOperator: "or",
          },
          message: "Your topic feed is ready.",
          issues: [],
          feedUrl: "https://worker.example/feed/canonical-token",
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page
      .getByLabel("Your request")
      .fill("Create a feed for CSS, JavaScript, and TypeScript that updates every 24 hours.");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByText("Your topic feed is ready.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /worker\.example\/feed/ })).toHaveAttribute(
      "href",
      "https://worker.example/feed/canonical-token",
    );
    await expectNoSeriousViolations(page);
  });

  test("returns to Guided mode when the runtime flag blocks a turn", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({ status: 404, json: { error: "Not found" } }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByText(/ask mode was disabled/i)).toBeVisible();
    await expect(
      page.getByRole("region", { name: /how do you want to build your feed/i }),
    ).toBeVisible();
  });

  test("does not render a malformed feed URL from an invalid API response", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "ready",
          draft: {
            source: "topics",
            topics: ["css"],
            username: null,
            repoSelection: null,
            activityType: "releases",
            ttl: 3600,
            format: "atom",
            topicOperator: "or",
          },
          message: "Your topic feed is ready.",
          issues: [],
          feedUrl: "http://malicious.example/feed/canonical-token",
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("link", { name: /malicious\.example/i })).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("could not finish");
  });

  test("shows and enforces the request character limit without truncating input", async ({
    page,
  }) => {
    let assistantCalls = 0;
    await page.route("**/api/assistant/turn", async (route) => {
      assistantCalls += 1;
      await route.abort();
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    const request = page.getByLabel("Your request");
    const overlongMessage = "x".repeat(1_001);
    await request.fill(overlongMessage);

    await expect(request).toHaveValue(overlongMessage);
    await expect(page.locator(".ask-feed__counter")).toContainText(
      "1000 character count limit exceeded",
    );
    await expect(page.locator(".ask-feed__counter")).toContainText("-1 characters remaining");
    await expect(page.locator(".ask-feed__counter")).toHaveClass(/counter--exceeded/);

    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("alert")).toContainText("exceeds the 1000 character limit");
    expect(assistantCalls).toBe(0);
  });

  test("uses the server retry delay in rate-limit feedback", async ({ page }) => {
    await page.route("**/api/assistant/turn", async (route) => {
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "17" },
        json: { error: "Too many requests" },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("alert")).toContainText("Try again in 17 seconds");
  });

  test("preserves Ask and Guided state across manual mode changes", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: /^guide me/i }).click();
    await page.getByRole("button", { name: "Create feed" }).click();
    await page.getByRole("button", { name: /feed by topic/i }).click();

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await expect(page.getByLabel("Your request")).toHaveValue("Create a CSS feed");

    await page.getByRole("button", { name: /^guide me/i }).click();
    await expect(page.getByRole("button", { name: /feed by topic/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("answers a capability question and lets the user continue with controls", async ({
    page,
  }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "choose-source",
          draft: {
            source: null,
            topics: [],
            username: null,
            repoSelection: null,
            activityType: "releases",
            ttl: 3600,
            format: "atom",
            topicOperator: "or",
          },
          message: "You can create feeds by GitHub topic or from a user's starred repositories.",
          issues: [],
          feedUrl: null,
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("What type of feeds can I create?");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("heading", { name: "Choose a feed source" })).toBeVisible();
    await page.getByRole("button", { name: /github topics/i }).click();
    await page.getByRole("checkbox", { name: "CSS" }).check();

    await expect(page.getByRole("heading", { name: "Feed recipe" })).toBeVisible();
    await expect(page.getByRole("button", { name: /generate feed url/i })).toBeVisible();
  });

  test("supports an incomplete request followed by clicks", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "edit-topics",
          draft: topicDraft([]),
          message: "Choose one or more GitHub topics for this feed.",
          issues: ["Include at least one topic."],
          feedUrl: null,
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("I want a topic feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Include at least one topic.", { exact: true })).toBeVisible();

    await page.getByRole("checkbox", { name: "TypeScript" }).check();
    await page.getByLabel("Update frequency").selectOption("86400");
    await page.getByRole("button", { name: /generate feed url/i }).click();

    await expect(page.getByRole("link", { name: /\/feed\//i })).toBeVisible();
    await expect(page.getByText("typescript OR", { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: /^guide me/i }).click();
    await page.getByRole("button", { name: "Create feed" }).click();
    await expect(page.getByRole("checkbox", { name: "TypeScript" })).toBeChecked();
    await expect(page.getByRole("link", { name: /\/feed\//i })).toBeVisible();
  });

  test("sends recent history for a correction and replaces the stale URL", async ({ page }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", async (route) => {
      requestNumber += 1;
      const body = route.request().postDataJSON();

      if (requestNumber === 1) {
        await route.fulfill({
          json: {
            state: "ready",
            draft: topicDraft(["css"]),
            message: "Your topic feed is ready.",
            issues: [],
            feedUrl: "https://worker.example/feed/first-token",
          },
        });
        return;
      }

      expect(body.state).toBe("ready");
      expect(body.draft.topics).toEqual(["css"]);
      expect(body.history).toHaveLength(2);
      await route.fulfill({
        json: {
          state: "ready",
          draft: topicDraft(["typescript"], 86400),
          message: "Your corrected topic feed is ready.",
          issues: [],
          feedUrl: "https://worker.example/feed/second-token",
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("link", { name: /first-token/i })).toBeVisible();

    await page.getByLabel("Your next message").fill("Use TypeScript and update every 24 hours");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("link", { name: /first-token/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /second-token/i })).toBeVisible();
    await expect(
      page.getByText("Your corrected topic feed is ready.", { exact: true }),
    ).toBeVisible();
  });

  test("renders deterministic invalid-topic and unsupported-setting recovery controls", async ({
    page,
  }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", async (route) => {
      requestNumber += 1;
      await route.fulfill({
        json:
          requestNumber === 1
            ? {
                state: "edit-topics",
                draft: topicDraft([]),
                message: "Some topics could not be found on GitHub.",
                issues: ["Check: not-a-real-topic"],
                feedUrl: null,
              }
            : {
                state: "edit-settings",
                draft: topicDraft(["css"]),
                message: "That update frequency is not available.",
                issues: ["Choose 1 hour, 6 hours, 24 hours, or 1 week."],
                feedUrl: null,
              },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a not-a-real-topic feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Check: not-a-real-topic", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Topics" })).toBeVisible();

    await page.getByLabel("Your next message").fill("Create CSS and update every 12 hours");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(
      page.getByText("Choose 1 hour, 6 hours, 24 hours, or 1 week.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Update frequency")).toBeVisible();
  });

  test("restores the validated conversation, draft, composer, and selected mode", async ({
    page,
  }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "edit-settings",
          draft: topicDraft(["css"]),
          message: "Review the feed settings.",
          issues: [],
          feedUrl: null,
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed and let me review it");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByLabel("Your next message").fill("Change the activity next");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const serialized = localStorage.getItem("ossreleasefeed:adaptive-session");
          return serialized ? JSON.parse(serialized).composer : null;
        }),
      )
      .toBe("Change the activity next");

    await page.reload();

    await expect(page.getByRole("article")).toBeVisible();
    await expect(page.getByLabel("Your next message")).toHaveValue("Change the activity next");
    await expect(page.getByText("Review the feed settings.", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "CSS" })).toBeChecked();
  });

  test("starts over without carrying conversation or draft state", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "ready",
          draft: topicDraft(["css"]),
          message: "Your topic feed is ready.",
          issues: [],
          feedUrl: "https://worker.example/feed/reset-token",
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByRole("button", { name: "Start over" }).click();

    await expect(page.getByLabel("Your request")).toHaveValue("");
    await expect(page.getByRole("link", { name: /reset-token/i })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Feed builder conversation" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Choose a feed source" })).toBeVisible();
  });

  test("offers a prefilled Guided fallback after an assistant or GitHub failure", async ({
    page,
  }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({ status: 503, json: { error: "Assistant temporarily unavailable" } }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("alert")).toContainText("could not finish");

    await page.getByRole("button", { name: "Continue with Guide me" }).click();
    await expect(
      page.getByRole("region", { name: /how do you want to build your feed/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await expect(page.getByLabel("Your request")).toHaveValue("Create a CSS feed");
  });

  test("renders its semantic form landmark and live feedback containers up front", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /ask for a feed/i }).click();

    await expect(page.getByRole("article")).toBeVisible();
    await expect(page.getByRole("form", { name: "Ask for a topic feed" })).toBeVisible();
    await expect(page.locator("output[aria-live='polite']")).toHaveCount(2);
  });
});
