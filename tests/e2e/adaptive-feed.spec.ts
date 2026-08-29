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
      await route.fulfill({ json: { adaptiveFeedBuilder: true } });
    });
    await page.route("**/api/topics/featured", (route) => route.fulfill({ json: topicsFixture }));
  });

  test("creates a topic feed from one typed request", async ({ page }) => {
    let assistantExperimentKey = "";
    let assistantMessage = "";

    await page.route("**/api/assistant/turn", async (route) => {
      const request = route.request();
      const body = request.postDataJSON();

      assistantExperimentKey = request.headers()["x-experiment-key"];
      assistantMessage = body.message;
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
          showUi: true,
          ttlSelected: true,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page
      .getByLabel("Your request")
      .fill("Create a feed for CSS, JavaScript, and TypeScript that updates every 24 hours.");
    await page.getByRole("button", { name: "Send request" }).click();

    expect(currentExperimentKey).toMatch(experimentKeyPattern);
    expect(assistantExperimentKey).toBe(currentExperimentKey);
    expect(assistantMessage).toContain("CSS, JavaScript, and TypeScript");
    const recipe = page.getByRole("region", { name: "Feed recipe" });

    await expect(recipe).toBeFocused();
    await expect(page.getByText("Your topic feed is ready.", { exact: true })).toBeVisible();
    const feedUrl = page.getByRole("link", { name: /worker\.example\/feed/ });

    await expect(feedUrl).toHaveAttribute("href", "https://worker.example/feed/canonical-token");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const recipeElement = document.querySelector<HTMLElement>("[data-feed-recipe]");
          const urlElement = document.querySelector<HTMLElement>(".feed-url");

          if (!recipeElement || !urlElement) {
            return false;
          }

          const recipeBounds = recipeElement.getBoundingClientRect();
          const urlBounds = urlElement.getBoundingClientRect();

          return recipeBounds.top >= 0 && urlBounds.bottom <= window.innerHeight;
        }),
      )
      .toBe(true);
    await expectNoSeriousViolations(page);
  });

  test("[adaptive_topic_001] replaces a ready summary with editable controls when the user asks to show the UI", async ({
    page,
  }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", (route) => {
      requestNumber += 1;

      return route.fulfill({
        json:
          requestNumber === 1
            ? {
                state: "ready",
                draft: topicDraft(["css", "javascript"], 86400),
                message: "Your topic feed is ready.",
                issues: [],
                feedUrl: "https://worker.example/feed/ready-token",
                showUi: true,
                ttlSelected: true,
              }
            : requestNumber === 2
              ? {
                  state: "edit-settings",
                  draft: topicDraft(["css", "javascript"], 86400),
                  message: "Here is the interface for your current feed.",
                  issues: [],
                  feedUrl: null,
                  showUi: true,
                  ttlSelected: true,
                }
              : {
                  state: "ready",
                  draft: topicDraft(["css", "javascript"], 86400),
                  message: "I've hidden the feed interface.",
                  issues: [],
                  feedUrl: "https://worker.example/feed/ready-token",
                  showUi: false,
                  ttlSelected: true,
                },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS and JavaScript feed every 24 hours");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("heading", { name: "Feed recipe" })).toBeVisible();
    await expect(page.getByRole("link", { name: /ready-token/i })).toBeVisible();
    await expect(page.getByLabel("Update frequency")).toHaveCount(0);

    await page.getByLabel("Your next message").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("heading", { name: "Topics" })).toBeVisible();
    await expect(page.getByLabel("Update frequency")).toHaveValue("86400");
    await expect(page.getByRole("button", { name: /generate feed url/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Feed recipe" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /ready-token/i })).toHaveCount(0);

    await page.getByLabel("Your next message").fill("Hide UI");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("heading", { name: "Topics" })).toHaveCount(0);
    await expect(page.getByLabel("Update frequency")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Feed recipe" })).toBeVisible();
    await expect(page.getByRole("link", { name: /ready-token/i })).toBeVisible();
    await expect(page.getByText("I've hidden the feed interface.", { exact: true })).toBeVisible();
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
          showUi: true,
          ttlSelected: true,
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

  test("records the Guided default interval before an Ask follow-up", async ({ page }) => {
    let assistantRequest: Record<string, unknown> | null = null;

    await page.route("**/api/assistant/turn", async (route) => {
      assistantRequest = route.request().postDataJSON();
      await route.fulfill({
        json: {
          state: "ready",
          draft: topicDraft(["css"]),
          message: "You can create feeds by GitHub topic or from a user's starred repositories.",
          issues: [],
          feedUrl: "https://worker.example/feed/guided-token",
          showUi: true,
          ttlSelected: true,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Create feed" }).click();
    await page.getByRole("button", { name: /feed by topic/i }).click();
    await page.getByRole("checkbox", { name: "CSS" }).check();
    await page.getByRole("button", { name: /generate feed url/i }).click();

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("What feeds can I create?");
    await page.getByRole("button", { name: "Send request" }).click();

    expect(assistantRequest).toMatchObject({
      state: "ready",
      draft: { source: "topics", topics: ["css"], ttl: 3600 },
      ttlSelected: true,
    });
  });

  test("answers a capability question and lets the user continue with controls", async ({
    page,
  }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", (route) => {
      requestNumber += 1;

      return route.fulfill({
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
          message:
            requestNumber === 1
              ? "You can create feeds by GitHub topic or from a user's starred repositories."
              : "Here is the interface for your current feed.",
          issues: [],
          feedUrl: null,
          showUi: requestNumber > 1,
          ttlSelected: false,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("What feeds can I create");
    await page.getByRole("button", { name: "Send request" }).click();

    const conversation = page.getByRole("list", { name: "Feed builder conversation" });

    await expect(
      conversation.getByText(
        "You can create feeds by GitHub topic or from a user's starred repositories.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a feed source" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Topics" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Feed recipe" })).toHaveCount(0);

    await page.getByLabel("Your next message").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { name: "Choose a feed source" })).toBeVisible();
    await page.getByRole("button", { name: /github topics/i }).click();
    await page.getByRole("checkbox", { name: "CSS" }).click();

    await expect(page.getByRole("heading", { name: "Feed recipe" })).toHaveCount(0);
    await expect(page.getByLabel("Update frequency")).toHaveValue("");
    await expect(page.getByRole("button", { name: /generate feed url/i })).toBeDisabled();
    await page.getByLabel("Update frequency").selectOption("3600");
    await expect(page.getByRole("button", { name: /generate feed url/i })).toBeEnabled();
    await page.getByRole("button", { name: /generate feed url/i }).click();
    await expect(page.getByRole("region", { name: "Feed recipe" })).toBeFocused();
  });

  test("supports an incomplete request followed by clicks", async ({ page }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", (route) => {
      requestNumber += 1;

      return route.fulfill({
        json: {
          state: "edit-topics",
          draft: topicDraft([]),
          message:
            requestNumber === 1
              ? "Next, choose one or more GitHub topics. I can show you the topic picker or list some examples."
              : "Here is the interface for your current feed.",
          issues: [],
          feedUrl: null,
          showUi: requestNumber > 1,
          ttlSelected: false,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("I want a topic feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Feed recipe" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Topics" })).toHaveCount(0);

    const conversation = page.locator("details.ask-feed__conversation");
    const conversationTurns = page.getByRole("list", { name: "Feed builder conversation" });

    await expect(conversation).toHaveAttribute("open", "");
    await expect(conversationTurns).toBeVisible();
    await conversation.locator("summary").click();
    await expect(conversationTurns).toBeHidden();
    await conversation.locator("summary").click();
    await expect(conversationTurns).toBeVisible();
    await expect
      .poll(() =>
        conversation.evaluate((element) => element.nextElementSibling?.tagName.toLowerCase()),
      )
      .toBe("form");

    await page.getByLabel("Your next message").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();

    await page.getByRole("checkbox", { name: "TypeScript" }).click();
    await page.getByLabel("Update frequency").selectOption("86400");
    await page.getByRole("button", { name: /generate feed url/i }).click();

    await expect(page.getByRole("link", { name: /\/feed\//i })).toBeVisible();
    await expect(page.getByText("typescript OR", { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: /^guide me/i }).click();
    await page.getByRole("button", { name: "Create feed" }).click();
    await expect(page.getByRole("checkbox", { name: "TypeScript" })).toBeChecked();
    await expect(page.getByRole("link", { name: /\/feed\//i })).toBeVisible();
  });

  test("guides the next decision and waits for permission before showing settings", async ({
    page,
  }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", (route) => {
      requestNumber += 1;

      const selectedTopics = requestNumber > 1 ? ["css", "javascript", "typescript"] : [];

      return route.fulfill({
        json: {
          state: requestNumber === 1 ? "edit-topics" : "edit-settings",
          draft: topicDraft(selectedTopics),
          message:
            requestNumber === 1
              ? "Featured topics include CSS, TypeScript, Compiler, and Awesome Lists. You can also specify your own GitHub topics."
              : requestNumber === 2
                ? "I selected 3 topics: css, javascript, and typescript. Next, choose how often the feed should update. I can show you the settings UI or list the available options."
                : "Here is the interface for your current feed.",
          issues: [],
          feedUrl: null,
          showUi: requestNumber > 2,
          ttlSelected: false,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("What topics are available?");
    await page.getByRole("button", { name: "Send request" }).click();

    const conversation = page.getByRole("list", { name: "Feed builder conversation" });

    await expect(conversation.getByText(/featured topics include css, typescript/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Topics" })).toHaveCount(0);

    await page
      .getByLabel("Your next message")
      .fill("Use the topics CSS, JavaScript, and TypeScript");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(
      conversation.getByText(/next, choose how often the feed should update/i),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Topics" })).toHaveCount(0);
    await expect(page.getByLabel("Update frequency")).toHaveCount(0);

    await page.getByLabel("Your next message").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByLabel("Update frequency")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Topics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a feed source" })).toHaveCount(0);
  });

  test("[adaptive_topic_002] revises the current configuration and displays its newly generated URL", async ({
    page,
  }) => {
    let requestNumber = 0;
    let revisionBody: {
      state?: unknown;
      draft?: unknown;
    } | null = null;

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
            showUi: true,
            ttlSelected: true,
          },
        });
        return;
      }

      revisionBody = body;
      await route.fulfill({
        json: {
          state: "ready",
          draft: topicDraft(["typescript"], 86400),
          message: "Your revised topic feed is ready.",
          issues: [],
          feedUrl: "https://worker.example/feed/second-token",
          showUi: true,
          ttlSelected: true,
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

    await expect.poll(() => requestNumber).toBe(2);
    expect(revisionBody?.state).toBe("ready");
    expect(revisionBody?.draft).toEqual(topicDraft(["css"]));
    expect(revisionBody).not.toHaveProperty("history");
    await expect(page.getByRole("link", { name: /first-token/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /second-token/i })).toBeVisible();
    const recipe = page.getByRole("region", { name: "Feed recipe" });

    await expect(recipe.getByText("css", { exact: true })).toHaveCount(0);
    await expect(recipe.getByText("typescript", { exact: true })).toBeVisible();
    await expect(recipe.getByText("24 hours", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Your revised topic feed is ready.", { exact: true }),
    ).toBeVisible();
  });

  test("[adaptive_topic_003] ignores a delayed response after the user changes a visible control", async ({
    page,
  }) => {
    let requestNumber = 0;
    let releaseStaleResponse: (() => void) | undefined;

    await page.route("**/api/assistant/turn", async (route) => {
      requestNumber += 1;

      if (requestNumber === 1) {
        await route.fulfill({
          json: {
            state: "edit-settings",
            draft: topicDraft(["css"]),
            message: "I selected the CSS topic.",
            issues: [],
            feedUrl: null,
            showUi: true,
            ttlSelected: false,
          },
        });
        return;
      }

      await new Promise<void>((resolve) => {
        releaseStaleResponse = resolve;
      });
      await route.fulfill({
        json: {
          state: "ready",
          draft: topicDraft(["typescript"], 86400),
          message: "This stale response must be ignored.",
          issues: [],
          feedUrl: "https://worker.example/feed/stale-token",
          showUi: true,
          ttlSelected: true,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();

    await page.getByLabel("Your next message").fill("Change this feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect.poll(() => typeof releaseStaleResponse).toBe("function");

    const javascriptTopic = page.getByRole("checkbox", { name: "JavaScript" });
    await javascriptTopic.check();
    releaseStaleResponse?.();

    await expect(page.getByRole("button", { name: "Send request" })).toBeEnabled();
    await expect(javascriptTopic).toBeFocused();
    await expect(
      page.getByText("This stale response must be ignored.", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: /stale-token/i })).toHaveCount(0);
    await expect(page.getByLabel("Your next message")).toHaveValue("Change this feed");
  });

  test("keeps recovery conversational until the user requests the relevant controls", async ({
    page,
  }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", async (route) => {
      requestNumber += 1;
      await route.fulfill({
        json: [
          {
            state: "edit-topics",
            draft: topicDraft([]),
            message: "Some topics could not be found on GitHub.",
            issues: ["Check: not-a-real-topic"],
            feedUrl: null,
            showUi: false,
            ttlSelected: false,
          },
          {
            state: "edit-topics",
            draft: topicDraft([]),
            message: "Here is the interface for your current feed.",
            issues: ["Check: not-a-real-topic"],
            feedUrl: null,
            showUi: true,
            ttlSelected: false,
          },
          {
            state: "edit-settings",
            draft: topicDraft(["css"]),
            message: "That update frequency is not available.",
            issues: ["Choose 1 hour, 6 hours, 24 hours, or 1 week."],
            feedUrl: null,
            showUi: false,
            ttlSelected: false,
          },
          {
            state: "edit-settings",
            draft: topicDraft(["css"]),
            message: "Here is the interface for your current feed.",
            issues: ["Choose 1 hour, 6 hours, 24 hours, or 1 week."],
            feedUrl: null,
            showUi: true,
            ttlSelected: false,
          },
        ][requestNumber - 1] ?? {
          state: "edit-topics",
          draft: topicDraft([]),
          message: "Unexpected request.",
          issues: [],
          feedUrl: null,
          showUi: false,
          ttlSelected: false,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a not-a-real-topic feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("list", { name: "Feed builder conversation" })).toContainText(
      "Check: not-a-real-topic",
    );
    await expect(page.getByRole("heading", { name: "Topics" })).toHaveCount(0);

    await page.getByLabel("Your next message").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { name: "Topics" })).toBeVisible();

    await page.getByLabel("Your next message").fill("Create CSS and update every 12 hours");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("list", { name: "Feed builder conversation" })).toContainText(
      "Choose 1 hour, 6 hours, 24 hours, or 1 week.",
    );
    await expect(page.getByLabel("Update frequency")).toHaveCount(0);

    await page.getByLabel("Your next message").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();
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
          showUi: true,
          ttlSelected: false,
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
    await expect(page.getByLabel("Update frequency")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Topics" })).toBeVisible();
  });

  test("returns focus to the message field after an assistant response", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "edit-settings",
          draft: topicDraft(["css"]),
          message: "Review the feed settings.",
          issues: [],
          feedUrl: null,
          showUi: true,
          ttlSelected: false,
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByLabel("Your next message")).toBeFocused();
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
          showUi: true,
          ttlSelected: true,
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
    await expect(page.getByRole("heading", { name: "Choose a feed source" })).toHaveCount(0);
  });

  test("handles the exact start over message locally", async ({ page }) => {
    let assistantRequests = 0;
    await page.route("**/api/assistant/turn", (route) => {
      assistantRequests += 1;

      return route.fulfill({
        json: {
          state: "ready",
          draft: topicDraft(["css"]),
          message: "Your topic feed is ready.",
          issues: [],
          feedUrl: "https://worker.example/feed/reset-token",
          showUi: true,
          ttlSelected: true,
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByLabel("Your next message").fill("start over");
    await page.getByRole("button", { name: "Send request" }).click();

    expect(assistantRequests).toBe(1);
    await expect(page.getByLabel("Your request")).toHaveValue("");
    await expect(page.getByRole("list", { name: "Feed builder conversation" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /reset-token/i })).toHaveCount(0);
  });

  test("offers a prefilled Guided fallback after an assistant or GitHub failure", async ({
    page,
  }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", (route) => {
      requestNumber += 1;

      if (requestNumber === 1) {
        return route.fulfill({
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
            message: "You can create feeds by GitHub topic or starred repositories.",
            issues: [],
            feedUrl: null,
            showUi: false,
            ttlSelected: false,
          },
        });
      }

      return route.fulfill({
        status: 503,
        json: { error: "Assistant temporarily unavailable" },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("What feeds can I create?");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByLabel("Your next message").fill("Create a CSS feed");
    await page.getByRole("button", { name: "Send request" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("could not finish");
    await expect
      .poll(() =>
        alert.evaluate((element) => ({
          previous: element.previousElementSibling?.tagName.toLowerCase(),
          next: element.nextElementSibling?.tagName.toLowerCase(),
        })),
      )
      .toEqual({ previous: "details", next: "form" });

    await page.getByRole("button", { name: "Continue with Guide me" }).click();
    await expect(
      page.getByRole("region", { name: /how do you want to build your feed/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await expect(page.getByLabel("Your next message")).toHaveValue("Create a CSS feed");
  });

  test("renders its semantic form landmark and live feedback containers up front", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /ask for a feed/i }).click();

    await expect(page.getByRole("article")).toBeVisible();
    await expect(page.getByRole("form", { name: "Ask for a feed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a feed source" })).toHaveCount(0);
    await expect(page.getByText("Adaptive topic builder", { exact: true })).toHaveCount(0);
    await expect(page.locator("output[aria-live='polite']")).toHaveCount(2);
  });

  test("does not restore saved Ask state over a Guided choice made while the flag loads", async ({
    page,
  }) => {
    await page.unroute("**/api/experiments");
    await page.addInitScript(() => {
      localStorage.setItem(
        "ossreleasefeed:adaptive-session",
        JSON.stringify({
          version: 4,
          savedAt: Date.now(),
          revision: 1,
          adaptiveState: "edit-topics",
          draft: {
            source: "topics",
            topics: [],
            username: null,
            repoSelection: null,
            activityType: "releases",
            ttl: 3600,
            format: "atom",
            topicOperator: "or",
          },
          feedUrl: null,
          transcript: [],
          composer: "Saved Ask request",
          issues: [],
          showUi: false,
          ttlSelected: false,
          selectedMode: "ask",
          builderStarted: false,
        }),
      );
    });
    await page.route("**/api/experiments", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ json: { adaptiveFeedBuilder: true } });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Create feed" }).click();
    await expect(
      page.getByRole("region", { name: /how do you want to build your feed/i }),
    ).toBeVisible();

    await expect(page.getByLabel("Your request")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^guide me/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("adaptive feed Phase 3", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/experiments", (route) =>
      route.fulfill({ json: { adaptiveFeedBuilder: true } }),
    );
    await page.route("**/api/topics/featured", (route) => route.fulfill({ json: topicsFixture }));
  });

  const starredDraft = (
    username: string | null,
    repoSelection: { kind: "all" } | { kind: "subset"; repos: string[] } | null,
    ttl = 3600,
  ) => ({
    source: "starred",
    topics: [],
    username,
    repoSelection,
    activityType: "releases",
    ttl,
    format: "atom",
    topicOperator: "or",
  });

  const repoFixture = [
    {
      full_name: "octocat/Hello-World",
      name: "Hello-World",
      description: "A hello-world repository",
      stargazers_count: 42,
      owner: { login: "octocat" },
    },
    {
      full_name: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
      description: "A spoon and knife",
      stargazers_count: 10,
      owner: { login: "octocat" },
    },
  ];

  test("creates an all-starred feed from one typed request", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "ready",
          draft: starredDraft("octocat", { kind: "all" }, 86400),
          message: "Your starred-repository feed is ready.",
          issues: [],
          feedUrl: "https://worker.example/feed/starred-token",
          showUi: true,
          ttlSelected: true,
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page
      .getByLabel("Your request")
      .fill("All of octocat's starred repositories, updating every 24 hours.");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(
      page.getByText("Your starred-repository feed is ready.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /worker\.example\/feed/ })).toHaveAttribute(
      "href",
      "https://worker.example/feed/starred-token",
    );
    await expect(page.getByText("All starred repositories", { exact: true })).toBeVisible();
    await expect(page.getByText("octocat", { exact: false }).first()).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("[starred_001] asks for a GitHub username conversationally when it is missing", async ({
    page,
  }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "enter-username",
          draft: starredDraft(null, null),
          message: "Which GitHub username should I use?",
          issues: [],
          feedUrl: null,
          showUi: false,
          ttlSelected: false,
        },
      }),
    );
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a feed from my starred repositories");
    await page.getByRole("button", { name: "Send request" }).click();

    const conversation = page.getByRole("list", { name: "Feed builder conversation" });
    await expect(conversation.getByText(/which github username should i use/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "GitHub username" })).toHaveCount(0);
    await expect(page.getByText("Your feed URL", { exact: true })).toHaveCount(0);
  });

  test("[starred_002] carries named repositories through the username follow-up", async ({
    page,
  }) => {
    const requestedRepos = ["warpdotdev/warp", "mattpocock/skills"];
    let requestNumber = 0;
    let usernameTurnDraft: Record<string, unknown> | null = null;

    await page.route("**/api/assistant/turn", async (route) => {
      requestNumber += 1;

      if (requestNumber === 2) {
        usernameTurnDraft = route.request().postDataJSON().draft;
      }

      return route.fulfill({
        json:
          requestNumber === 1
            ? {
                state: "enter-username",
                draft: starredDraft(null, { kind: "subset", repos: requestedRepos }),
                message: "Which GitHub username should I use?",
                issues: [],
                feedUrl: null,
                showUi: false,
                ttlSelected: false,
              }
            : {
                state: "edit-settings",
                draft: starredDraft(
                  "schalkneethling",
                  { kind: "subset", repos: requestedRepos },
                  3600,
                ),
                message:
                  "I selected 2 repositories: warpdotdev/warp and mattpocock/skills. Next, choose how often the feed should update.",
                issues: [],
                feedUrl: null,
                showUi: false,
                ttlSelected: false,
              },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page
      .getByLabel("Your request")
      .fill("Create a feed from warpdotdev/warp and mattpocock/skills in my starred repos");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByLabel("Your next message").fill("schalkneethling");
    await page.getByRole("button", { name: "Send request" }).click();

    expect(usernameTurnDraft).toMatchObject({
      source: "starred",
      username: null,
      repoSelection: { kind: "subset", repos: requestedRepos },
    });
    await expect(
      page
        .getByRole("list", { name: "Feed builder conversation" })
        .getByText(/I selected 2 repositories: warpdotdev\/warp and mattpocock\/skills/i),
    ).toBeVisible();
  });

  test("reveals the username field and repository picker on request", async ({ page }) => {
    let requestNumber = 0;
    await page.route("**/api/assistant/turn", (route) => {
      requestNumber += 1;

      return route.fulfill({
        json:
          requestNumber === 1
            ? {
                state: "enter-username",
                draft: starredDraft(null, null),
                message: "Here is the interface for your current feed.",
                issues: [],
                feedUrl: null,
                showUi: true,
                ttlSelected: false,
              }
            : {
                state: "choose-repos",
                draft: starredDraft("octocat", null),
                message: "Here is the interface for your current feed.",
                issues: [],
                feedUrl: null,
                showUi: true,
                ttlSelected: false,
              },
      });
    });
    await page.route("**/api/starred/octocat", (route) => route.fulfill({ json: repoFixture }));
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();

    const usernameField = page.getByRole("textbox", { name: "GitHub username" });
    await expect(usernameField).toBeVisible();
    await usernameField.fill("octocat");

    await expect(page.getByRole("list", { name: "Starred repositories" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(2);
    await expect(page.getByRole("checkbox").first()).not.toBeChecked();

    await page.getByRole("button", { name: "Include all starred repositories" }).click();
    await expect(page.getByText(/including all of @octocat/i)).toBeVisible();

    await page.getByLabel("Update frequency").selectOption("86400");
    await page.getByRole("button", { name: /generate feed url/i }).click();

    await expect(page.getByRole("link", { name: /\/feed\//i })).toBeVisible();
    await expect(page.getByText("All starred repositories", { exact: true })).toBeVisible();
  });

  test("[starred_003] debounces repository loading and clears results when the visible username changes", async ({
    page,
  }) => {
    let changedUsernameRepoCalls = 0;
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "edit-settings",
          draft: starredDraft("octocat", {
            kind: "subset",
            repos: ["octocat/Hello-World"],
          }),
          message: "Here is the interface for your current feed.",
          issues: [],
          feedUrl: null,
          showUi: true,
          ttlSelected: false,
        },
      }),
    );
    await page.route("**/api/starred/octocat", (route) => route.fulfill({ json: repoFixture }));
    await page.route("**/api/starred/schalkneethling", (route) => {
      changedUsernameRepoCalls += 1;

      return route.fulfill({
        json: [
          {
            ...repoFixture[0],
            full_name: "github/docs",
            name: "docs",
            owner: { login: "github" },
          },
        ],
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("octocat/Hello-World", { exact: true })).toBeVisible();

    await page.getByRole("textbox", { name: "GitHub username" }).fill("  schalkneethling  ");
    await expect(page.getByText("octocat/Hello-World", { exact: true })).toHaveCount(0);
    expect(changedUsernameRepoCalls).toBe(0);
    await expect(page.getByText("github/docs", { exact: true })).toBeVisible({
      timeout: 2000,
    });
    expect(changedUsernameRepoCalls).toBe(1);
  });

  test("builds a subset starred feed with the repository picker", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "choose-repos",
          draft: starredDraft("octocat", null),
          message: "Here is the interface for your current feed.",
          issues: [],
          feedUrl: null,
          showUi: true,
          ttlSelected: false,
        },
      }),
    );
    await page.route("**/api/starred/octocat", (route) => route.fulfill({ json: repoFixture }));
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Show UI");
    await page.getByRole("button", { name: "Send request" }).click();

    await page.getByRole("checkbox", { name: /hello-world/i }).check();
    await page.getByLabel("Update frequency").selectOption("3600");
    await page.getByRole("button", { name: /generate feed url/i }).click();

    await expect(page.getByRole("link", { name: /\/feed\//i })).toBeVisible();
    await expect(
      page.locator(".feed-recipe").getByText("octocat/Hello-World", { exact: true }),
    ).toBeVisible();
  });

  test("continues a starred Ask draft in the guided builder", async ({ page }) => {
    await page.route("**/api/assistant/turn", (route) =>
      route.fulfill({
        json: {
          state: "choose-repos",
          draft: starredDraft("octocat", null),
          message:
            "Found @octocat. Do you want all of their starred repositories or a specific selection?",
          issues: [],
          feedUrl: null,
          showUi: false,
          ttlSelected: false,
        },
      }),
    );
    await page.route("**/api/users/validate/octocat", (route) =>
      route.fulfill({ json: { exists: true, username: "octocat", hasStars: true } }),
    );
    await page.route("**/api/starred/octocat", (route) => route.fulfill({ json: repoFixture }));
    await page.goto("/");

    await page.getByRole("button", { name: /ask for a feed/i }).click();
    await page.getByLabel("Your request").fill("Create a feed from octocat's starred repositories");
    await page.getByRole("button", { name: "Send request" }).click();

    await page.getByRole("button", { name: /^guide me/i }).click();
    await page.getByRole("button", { name: "Create feed" }).click();

    await expect(page.getByRole("button", { name: /feed by stars/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const usernameField = page.getByRole("textbox", { name: "GitHub username" });
    await expect(usernameField).toHaveValue("octocat");
    await expect(page.getByRole("list", { name: "Starred repositories" })).toBeVisible({
      timeout: 5000,
    });
  });
});
