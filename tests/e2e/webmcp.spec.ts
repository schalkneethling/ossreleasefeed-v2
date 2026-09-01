import { expect, test, type Page } from "@playwright/test";

type ToolInvocationResult = {
  ok: boolean;
  feedUrl?: string;
  workspace?: {
    state: string;
    draft: { topics: string[]; activityType: string; ttl: number };
    feedUrl: string | null;
  };
};

const installWebMcpFake = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    type FakeTool = {
      name: string;
      execute: (
        input: Record<string, unknown>,
        options: { signal: AbortSignal },
      ) => unknown | Promise<unknown>;
    };
    type Registration = {
      generation: number;
      tool: FakeTool;
      aborted: boolean;
    };

    const active = new Map<string, Registration>();
    const history: Registration[] = [];
    let generation = 0;
    const modelContext = {
      registerTool(tool: FakeTool, options: { signal?: AbortSignal } = {}): Promise<void> {
        if (active.has(tool.name)) {
          return Promise.reject(new DOMException("Duplicate tool", "InvalidStateError"));
        }

        generation += 1;
        const registration = { generation, tool, aborted: false };
        active.set(tool.name, registration);
        history.push(registration);
        options.signal?.addEventListener(
          "abort",
          () => {
            registration.aborted = true;

            if (active.get(tool.name) === registration) {
              active.delete(tool.name);
            }
          },
          { once: true },
        );

        return Promise.resolve();
      },
    };

    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });
    Object.defineProperty(window, "__webMcpTest", {
      configurable: true,
      value: {
        activeNames: () => [...active.keys()].sort(),
        abortedRegistrations: () => history.filter((registration) => registration.aborted).length,
        async invoke(name: string, input: Record<string, unknown>) {
          const registration = active.get(name);

          if (!registration) {
            throw new Error(`Tool is not active: ${name}`);
          }

          return registration.tool.execute(input, {
            signal: new AbortController().signal,
          });
        },
      },
    });
  });
};

const activeToolNames = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (
      window as typeof window & {
        __webMcpTest: { activeNames: () => string[] };
      }
    ).__webMcpTest.activeNames(),
  );

const invokeTool = (
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolInvocationResult> =>
  page.evaluate(
    ({ input: toolInput, name: toolName }) =>
      (
        window as typeof window & {
          __webMcpTest: {
            invoke: (name: string, input: Record<string, unknown>) => Promise<ToolInvocationResult>;
          };
        }
      ).__webMcpTest.invoke(toolName, toolInput),
    { input, name },
  );

const decodeFeedToken = (url: string): unknown => {
  const token = url.split("/feed/")[1];
  const base64 = token.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
};

test("[webmcp_001] builds a topic feed through the visible trusted UI", async ({ page }) => {
  let assistantCalls = 0;
  await installWebMcpFake(page);
  await page.route("**/api/experiments", (route) =>
    route.fulfill({ json: { adaptiveFeedBuilder: false } }),
  );
  await page.route("**/api/topics/featured", (route) =>
    route.fulfill({
      json: [
        { name: "css", display_name: "CSS", short_description: "Cascading Style Sheets" },
        {
          name: "typescript",
          display_name: "TypeScript",
          short_description: "Typed JavaScript",
        },
      ],
    }),
  );
  await page.route("**/api/topics/validate**", (route) => {
    const slug = new URL(route.request().url()).searchParams.get("q");

    return route.fulfill({ json: { exists: true, name: slug } });
  });
  await page.route("**/api/assistant/turn", (route) => {
    assistantCalls += 1;
    return route.abort();
  });
  await page.goto("/");

  await expect(page.getByLabel("WebMCP support")).toContainText(
    "WebMCP available — browser agent tools are available on this page.",
  );
  await expect
    .poll(() => activeToolNames(page))
    .toEqual(["choose-feed-source", "read-feed-workspace"]);

  await invokeTool(page, "choose-feed-source", { source: "topics" });

  await expect(page.getByRole("heading", { name: "Choose your topics" })).toBeVisible();
  await expect
    .poll(() => activeToolNames(page))
    .toEqual(["choose-feed-source", "read-feed-workspace", "set-topics"]);

  await invokeTool(page, "set-topics", { topics: ["css", "typescript"] });

  await expect(page.getByRole("list", { name: "Selected topics" })).toContainText("css");
  await expect(page.getByRole("list", { name: "Selected topics" })).toContainText("typescript");
  await expect(page.getByRole("heading", { name: "Configure your feed" })).toBeVisible();
  await expect
    .poll(() => activeToolNames(page))
    .toEqual(["choose-feed-source", "read-feed-workspace", "set-feed-settings", "set-topics"]);

  await invokeTool(page, "set-feed-settings", { activityType: "all", ttl: 86400 });

  await expect(page.getByLabel("All activity (releases, issues, PRs)")).toBeChecked();
  await expect(page.getByLabel("Update frequency")).toHaveValue("86400");
  await expect
    .poll(() => activeToolNames(page))
    .toEqual([
      "choose-feed-source",
      "generate-feed-url",
      "read-feed-workspace",
      "set-feed-settings",
      "set-topics",
    ]);

  const generated = await invokeTool(page, "generate-feed-url", {});

  expect(generated.ok).toBe(true);
  expect(generated.feedUrl).toMatch(/^\/feed\/[A-Za-z0-9_-]+$/u);
  await expect(page.getByRole("link", { name: generated.feedUrl })).toHaveAttribute(
    "href",
    generated.feedUrl,
  );
  expect(generated.feedUrl && decodeFeedToken(generated.feedUrl)).toEqual({
    activityType: "all",
    format: "atom",
    source: "topics",
    topicOperator: "or",
    topics: ["css", "typescript"],
    ttl: 86400,
  });

  const finalWorkspace = await invokeTool(page, "read-feed-workspace", {});
  const abortedRegistrations = await page.evaluate(() =>
    (
      window as typeof window & {
        __webMcpTest: { abortedRegistrations: () => number };
      }
    ).__webMcpTest.abortedRegistrations(),
  );

  expect(finalWorkspace).toMatchObject({
    ok: true,
    workspace: {
      state: "ready",
      feedUrl: generated.feedUrl,
      draft: { topics: ["css", "typescript"], activityType: "all", ttl: 86400 },
    },
  });
  expect(abortedRegistrations).toBeGreaterThan(0);
  expect(assistantCalls).toBe(0);
});

test("[webmcp_004] manual completion wins over a slow WebMCP topic selection", async ({ page }) => {
  let slowValidationStarted = false;
  let releaseSlowValidation: (() => void) | undefined;
  await installWebMcpFake(page);
  await page.route("**/api/experiments", (route) =>
    route.fulfill({ json: { adaptiveFeedBuilder: false } }),
  );
  await page.route("**/api/topics/featured", (route) =>
    route.fulfill({
      json: [
        { name: "css", display_name: "CSS", short_description: "Cascading Style Sheets" },
        {
          name: "typescript",
          display_name: "TypeScript",
          short_description: "Typed JavaScript",
        },
      ],
    }),
  );
  await page.route("**/api/topics/validate**", async (route) => {
    const slug = new URL(route.request().url()).searchParams.get("q");

    if (slug === "css") {
      slowValidationStarted = true;
      await new Promise<void>((resolve) => {
        releaseSlowValidation = resolve;
      });

      try {
        await route.fulfill({ json: { exists: true, name: slug } });
      } catch {
        // The browser has already cancelled the superseded validation request.
      }

      return;
    }

    await route.fulfill({ json: { exists: true, name: slug } });
  });
  await page.goto("/");
  await invokeTool(page, "choose-feed-source", { source: "topics" });

  const slowWebMcpSelection = invokeTool(page, "set-topics", { topics: ["css"] });
  await expect.poll(() => slowValidationStarted).toBe(true);

  await page.getByRole("checkbox", { name: "TypeScript" }).check();
  await page.getByLabel("Update frequency").selectOption("86400");
  await page.getByRole("button", { name: "Generate feed URL" }).click();

  if (!releaseSlowValidation) {
    throw new Error("Expected the slow WebMCP validation to start.");
  }

  releaseSlowValidation();

  const manualUrl = page.getByRole("link", { name: /\/feed\//i });
  await expect(manualUrl).toBeVisible();
  await expect(slowWebMcpSelection).resolves.toMatchObject({
    ok: false,
    error: { code: "stale-workspace" },
  });
  await expect(page.getByRole("list", { name: "Selected topics" })).toContainText("typescript");
  await expect(page.getByRole("list", { name: "Selected topics" })).not.toContainText("css");
  expect(decodeFeedToken((await manualUrl.getAttribute("href")) ?? "")).toMatchObject({
    topics: ["typescript"],
    ttl: 86400,
  });
});
