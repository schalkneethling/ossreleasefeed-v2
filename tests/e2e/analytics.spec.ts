import { expect, test, type Page, type Route } from "@playwright/test";

type UmamiEvent = { name: string; data?: Record<string, unknown> };

const topicsFixture = [{ name: "react", display_name: "React", short_description: "A UI library" }];

const fulfillTopics = (route: Route) => route.fulfill({ json: topicsFixture });

const stubUmami = async (page: Page) => {
  // The real Umami script loads asynchronously and would
  // overwrite window.umami after addInitScript runs, clobbering the stub.
  await page.route("https://analytics.schalkneethling.com/analytics.js", (route) => route.abort());
  await page.addInitScript(() => {
    const events: { name: string; data?: Record<string, unknown> }[] = [];
    Object.assign(window, { __umamiEvents: events });
    Object.assign(window, {
      umami: {
        track: (name: string, data?: Record<string, unknown>) => events.push({ name, data }),
      },
    });
  });
};

const getEvents = (page: Page): Promise<UmamiEvent[]> =>
  page.evaluate(() => (window as unknown as { __umamiEvents: UmamiEvent[] }).__umamiEvents);

const hasEvent = async (
  page: Page,
  name: string,
  dataMatches?: (data: Record<string, unknown> | undefined) => boolean,
): Promise<boolean> => {
  const events = await getEvents(page);
  return events.some((event) => event.name === name && (!dataMatches || dataMatches(event.data)));
};

test.describe("Umami analytics events", () => {
  test("fires 'Feed builder started' when the CTA is clicked", async ({ page }) => {
    await stubUmami(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Create feed" }).click();

    await expect.poll(() => hasEvent(page, "Feed builder started")).toBe(true);
  });

  test("fires 'Feed type selected' with the chosen mode", async ({ page }) => {
    await stubUmami(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Create feed" }).click();
    await page.getByRole("button", { name: /feed by topic/i }).click();

    await expect
      .poll(() => hasEvent(page, "Feed type selected", (data) => data?.mode === "topics"))
      .toBe(true);
  });

  test("fires 'Feed URL generated successfully' after generating a topic feed", async ({
    page,
  }) => {
    await stubUmami(page);
    await page.route("**/api/topics/featured", fulfillTopics);
    await page.goto("/");
    await page.getByRole("button", { name: "Create feed" }).click();
    await page.getByRole("button", { name: /feed by topic/i }).click();
    await page.getByRole("checkbox", { name: "React" }).check();
    await page.getByRole("button", { name: /generate feed url/i }).click();

    await expect
      .poll(() =>
        hasEvent(page, "Feed URL generated successfully", (data) => data?.source === "topics"),
      )
      .toBe(true);
  });

  test("fires 'Feed generation failed' when a username lookup finds no such user", async ({
    page,
  }) => {
    await stubUmami(page);
    await page.route("**/api/users/validate/**", (route) =>
      route.fulfill({ json: { exists: false, username: null, hasStars: false } }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Create feed" }).click();
    await page.getByRole("button", { name: /feed by stars/i }).click();
    await page.getByRole("textbox", { name: /github username/i }).fill("nobody-xyz-404");

    await expect
      .poll(() =>
        hasEvent(
          page,
          "Feed generation failed",
          (data) => data?.errorType === "username-not-found",
        ),
      )
      .toBe(true);
  });

  test("fires 'Copy button clicked' when the copy button is clicked", async ({ page }) => {
    await stubUmami(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/topics/featured", fulfillTopics);
    await page.goto("/");
    await page.getByRole("button", { name: "Create feed" }).click();
    await page.getByRole("button", { name: /feed by topic/i }).click();
    await page.getByRole("checkbox", { name: "React" }).check();
    await page.getByRole("button", { name: /generate feed url/i }).click();
    await page.getByRole("button", { name: /copy url/i }).click();

    await expect.poll(() => hasEvent(page, "Copy button clicked")).toBe(true);
  });
});
