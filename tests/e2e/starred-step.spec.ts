import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const makeRepo = (i: number) => ({
  full_name: `owner/repo-${i}`,
  name: `repo-${i}`,
  description: i % 4 === 0 ? null : `Description for repo ${i}`,
  stargazers_count: (50 - i) * 10,
  owner: { login: "owner" },
});

// 30 repos so we can test pagination (25 shown initially, 5 more on Load more)
const reposFixture = Array.from({ length: 30 }, (_, i) => makeRepo(i + 1));

const gotoStarredStep = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create feed" }).click();
  await page.getByRole("button", { name: /feed by stars/i }).click();
};

const setupValidUser = async (page: Page, username = "octocat") => {
  await page.route(`**/api/users/validate/${username}`, (route) =>
    route.fulfill({ json: { exists: true, username, hasStars: true } }),
  );
  await page.route(`**/api/starred/${username}`, (route) => route.fulfill({ json: reposFixture }));
};

test.describe("username input", () => {
  test("shows no error for an empty field", async ({ page }) => {
    await gotoStarredStep(page);

    await expect(page.getByRole("textbox", { name: /github username/i })).toBeVisible();
    await expect(page.getByText(/no github user found/i)).toHaveCount(0);
  });

  test("shows not-found error after debounce for an unknown username", async ({ page }) => {
    await page.route("**/api/users/validate/**", (route) =>
      route.fulfill({ json: { exists: false, username: null, hasStars: false } }),
    );
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("nobody-xyz-404");
    await expect(page.getByText(/no github user found/i)).toBeVisible({ timeout: 2000 });
  });

  test("shows no-stars error for a user with no starred repos", async ({ page }) => {
    await page.route("**/api/users/validate/**", (route) =>
      route.fulfill({ json: { exists: true, username: "nostars", hasStars: false } }),
    );
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("nostars");
    await expect(page.getByText(/has no public starred repositories/i)).toBeVisible({
      timeout: 2000,
    });
  });

  test("shows error when GitHub is unavailable", async ({ page }) => {
    await page.route("**/api/users/validate/**", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByText(/could not reach github/i)).toBeVisible({ timeout: 2000 });
  });
});

test.describe("repo list", () => {
  test("shows initial 25 repos all selected by default", async ({ page }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    const checkboxes = page.getByRole("checkbox");
    await expect(checkboxes).toHaveCount(25);
    // All 25 are checked by default
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).toBeChecked();
    }
  });

  test("'Load more' appends next repos without losing selections", async ({ page }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    // Deselect one to verify it stays deselected after load more
    await page.getByRole("checkbox").first().uncheck();

    await page.getByRole("button", { name: /load more/i }).click();

    // All 30 repos should now be visible
    await expect(page.getByRole("checkbox")).toHaveCount(30);
    // The first one is still unchecked
    await expect(page.getByRole("checkbox").first()).not.toBeChecked();
    // Load more button is gone
    await expect(page.getByRole("button", { name: /load more/i })).toHaveCount(0);
  });

  test("filter shows only matching repos", async ({ page }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    await page.getByRole("searchbox", { name: /filter repositories/i }).fill("repo-1");
    // Matches repo-1, repo-10..repo-19 (11 repos with "repo-1" in the name)
    const visible = page.getByRole("checkbox");
    const count = await visible.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(25);
  });

  test("'Deselect all' clears all selections", async ({ page }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    await page.getByRole("button", { name: /deselect all/i }).click();

    for (const checkbox of await page.getByRole("checkbox").all()) {
      await expect(checkbox).not.toBeChecked();
    }
  });

  test("'Select all' restores selections up to the cap", async ({ page }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    await page.getByRole("button", { name: /deselect all/i }).click();
    await page.getByRole("button", { name: /select all/i }).click();

    const checked = page.getByRole("checkbox").filter({ has: page.locator(":checked") });
    await expect(checked).toHaveCount(25);
  });

  test("enforces 25-repo selection cap with an announcement", async ({ page }) => {
    // Use exactly 25 repos so all start selected, then load 5 more and try to select one
    await page.route("**/api/users/validate/octocat", (route) =>
      route.fulfill({ json: { exists: true, username: "octocat", hasStars: true } }),
    );
    await page.route("**/api/starred/octocat", (route) => route.fulfill({ json: reposFixture }));
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    // Already at cap (25 selected out of 25 shown). Load more to see extra repos.
    await page.getByRole("button", { name: /load more/i }).click();
    await expect(page.getByRole("checkbox")).toHaveCount(30);

    // The extra repos (26-30) should be disabled since we're at cap
    await expect(page.getByText(/selection limit reached/i)).toBeVisible();
    const lastCheckbox = page.getByRole("checkbox").last();
    await expect(lastCheckbox).toBeDisabled();
  });
});

test.describe("feed URL generation", () => {
  test("generates a URL after selecting repos", async ({ page }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    await page.getByRole("button", { name: /generate feed url/i }).click();

    const link = page.getByRole("link", { name: /\/feed\//i });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/\/feed\/.+/);
  });

  test("copy button changes label to 'Copied!' then reverts", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    await page.getByRole("button", { name: /generate feed url/i }).click();
    await page.getByRole("button", { name: /copy url/i }).click();

    await expect(page.getByRole("button", { name: /copied!/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /copy url/i })).toBeVisible({ timeout: 3000 });
  });

  test("'Generate feed URL' is disabled when no repos are selected", async ({ page }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });

    await page.getByRole("button", { name: /deselect all/i }).click();
    await expect(page.getByRole("button", { name: /generate feed url/i })).toBeDisabled();
  });
});

test.describe("accessibility", () => {
  test("starred step with repo list has no critical or serious axe violations", async ({
    page,
  }) => {
    await setupValidUser(page);
    await gotoStarredStep(page);

    await page.getByRole("textbox", { name: /github username/i }).fill("octocat");
    await expect(page.getByRole("list", { name: /starred repositories/i })).toBeVisible({
      timeout: 2000,
    });
    await page.getByRole("button", { name: /generate feed url/i }).click();
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
