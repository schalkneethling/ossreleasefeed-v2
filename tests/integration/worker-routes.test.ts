import { Either } from "effect";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../worker/src/index";
import { DEFAULT_FEED_DRAFT } from "../../worker/src/assistant/contracts";
import { decodeFeedConfig, encodeFeedConfig } from "../../worker/src/lib/config";
import type { FeedConfig } from "../../worker/src/lib/schemas";
import { captureFeedError } from "../../worker/src/lib/sentry";
import type { WorkerBindings } from "../../worker/src/lib/types";
import { encodeRawConfig } from "../helpers";
import { server } from "./setup";

vi.mock("../../worker/src/lib/sentry", () => ({
  captureFeedError: vi.fn<(error: unknown) => void>(),
  sentryOptions: () => undefined,
}));

const env: WorkerBindings = {
  APP_NAME: "ossreleasefeed",
  GITHUB_PAT: "test-token",
};

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
} as ExecutionContext;

const fetchApp = (url: string, init?: RequestInit, bindings: WorkerBindings = env) =>
  app.fetch(new Request(url, init), bindings, executionContext);

const experimentKey = "test-experiment-key-1234";

const makeAssistantEnv = ({
  enabled = true,
  aiResponse = {
    intent: "create-or-update-feed",
    proposedState: "ready",
    draftPatch: {
      source: "topics",
      topics: ["css", "javascript", "typescript"],
      ttl: 86400,
      activityType: "releases",
    },
  },
  clientAllowed = true,
  networkAllowed = true,
  aiError,
}: {
  enabled?: boolean;
  aiResponse?: unknown;
  clientAllowed?: boolean;
  networkAllowed?: boolean;
  aiError?: Error;
} = {}) => {
  const getBooleanValue = vi.fn<
    (flag: string, defaultValue: boolean, context: Record<string, string>) => Promise<boolean>
  >(async () => enabled);
  const run = vi.fn<
    (
      model: string,
      input: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ) => Promise<unknown>
  >(async () => {
    if (aiError) {
      throw aiError;
    }

    return { response: aiResponse };
  });
  const clientLimit = vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(
    async () => ({ success: clientAllowed }),
  );
  const networkLimit = vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(
    async () => ({ success: networkAllowed }),
  );
  const bindings: WorkerBindings = {
    ...env,
    FLAGS: { getBooleanValue } as unknown as Flagship,
    AI: { run },
    ASSISTANT_CLIENT_RATE_LIMITER: { limit: clientLimit },
    ASSISTANT_NETWORK_RATE_LIMITER: { limit: networkLimit },
  };

  return { bindings, getBooleanValue, run, clientLimit, networkLimit };
};

const assistantRequest = (message: string) => ({
  message,
  history: [],
  state: "idle" as const,
  draft: DEFAULT_FEED_DRAFT,
  issues: [],
  ttlSelected: false,
});

const atomFixture = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>v1.0.0</title>
    <link rel="alternate" type="text/html" href="https://github.com/example/repo/releases/tag/v1.0.0" />
    <updated>2026-03-01T08:00:00.000Z</updated>
    <content type="html">&lt;p&gt;First stable release&lt;/p&gt;</content>
    <author>
      <name>octocat</name>
    </author>
  </entry>
</feed>`;

const repoFixture = {
  full_name: "example/repo",
  name: "repo",
  description: "Example repository",
  stargazers_count: 42,
  owner: {
    login: "example",
  },
};

const starredConfig: FeedConfig = {
  source: "starred",
  username: "octocat",
  repos: ["example/repo"],
  activityType: "releases",
  ttl: 3600,
  format: "atom",
};

const releasesAtomHandler = (onCall?: () => void) =>
  http.get("https://github.com/example/repo/releases.atom", () => {
    onCall?.();

    return new HttpResponse(atomFixture, {
      headers: {
        "Content-Type": "application/atom+xml; charset=utf-8",
      },
    });
  });

// Records any GitHub request so tests can assert validation rejects input
// before a single call leaves the Worker.
const recordGitHubCalls = () => {
  const calls: string[] = [];

  server.use(
    http.all("https://api.github.com/*", ({ request }) => {
      calls.push(request.url);

      return HttpResponse.json({});
    }),
    http.all("https://github.com/*", ({ request }) => {
      calls.push(request.url);

      return new HttpResponse("");
    }),
  );

  return calls;
};

// Minimal stand-in for the Cloudflare Cache API, keyed by request URL.
class FakeCache {
  store = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.store.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response);
  }
}

const installFakeCache = (): FakeCache => {
  const cache = new FakeCache();

  Reflect.set(globalThis, "caches", { default: cache });

  return cache;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "caches");
  vi.mocked(captureFeedError).mockClear();
});

describe("GET /feed/:config", () => {
  it("returns atom feed output for a valid starred release config", async () => {
    server.use(releasesAtomHandler());

    const response = await fetchApp(`https://example.com/feed/${encodeFeedConfig(starredConfig)}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/atom+xml");
    expect(body).toContain("[example/repo] Release: v1.0.0");
    expect(captureFeedError).not.toHaveBeenCalled();
  });

  it("returns atom feed output for a valid topic config", async () => {
    server.use(
      http.get("https://api.github.com/search/repositories", () =>
        HttpResponse.json({
          total_count: 1,
          incomplete_results: false,
          items: [repoFixture],
        }),
      ),
      releasesAtomHandler(),
    );

    const config = encodeFeedConfig({
      source: "topics",
      topics: ["web-components"],
      topicOperator: "or",
      activityType: "releases",
      ttl: 3600,
      format: "atom",
    });
    const response = await fetchApp(`https://example.com/feed/${config}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/atom+xml");
    expect(body).toContain("[example/repo] Release: v1.0.0");
  });

  it("returns JSON Feed output when the config requests json", async () => {
    server.use(releasesAtomHandler());

    const config = encodeFeedConfig({ ...starredConfig, format: "json" });
    const response = await fetchApp(`https://example.com/feed/${config}`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/feed+json");
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].url).toBe("https://github.com/example/repo/releases/tag/v1.0.0");
  });

  it("returns 400 for malformed feed config tokens", async () => {
    const calls = recordGitHubCalls();
    const response = await fetchApp("https://example.com/feed/not-valid");
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid feed configuration");
    expect(calls).toHaveLength(0);
  });

  it("returns 400 for well-formed JSON that fails schema constraints", async () => {
    const calls = recordGitHubCalls();
    const config = encodeRawConfig({
      source: "topics",
      topics: ["web-components"],
      activityType: "releases",
      ttl: 300,
    });
    const response = await fetchApp(`https://example.com/feed/${config}`);

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it(
    "returns 503 when GitHub rate-limits and no cached feed exists",
    // The mocked retry-after of 1s is retried twice before the error propagates, so this takes ~2s.
    { timeout: 6_000 },
    async () => {
      server.use(
        http.get(
          "https://github.com/example/repo/releases.atom",
          () =>
            new HttpResponse("rate limited", {
              status: 429,
              headers: { "retry-after": "1" },
            }),
        ),
      );

      const response = await fetchApp(
        `https://example.com/feed/${encodeFeedConfig(starredConfig)}`,
      );
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload.error).toBe("GitHub temporarily unavailable");
      expect(captureFeedError).toHaveBeenCalledTimes(1);
      expect(captureFeedError).toHaveBeenCalledWith(
        expect.objectContaining({ _tag: "GitHubRateLimitError" }),
      );
    },
  );

  it("returns an empty but valid feed when individual repo atom feeds return errors", async () => {
    server.use(
      http.get(
        "https://github.com/example/repo/releases.atom",
        () => new HttpResponse("not found", { status: 404 }),
      ),
    );

    const response = await fetchApp(`https://example.com/feed/${encodeFeedConfig(starredConfig)}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/atom+xml");
    expect(body).toContain("<?xml");
    expect(body).not.toContain("<entry>");
  });

  it("serves a cache hit without calling GitHub again", async () => {
    installFakeCache();

    let githubCalls = 0;

    server.use(releasesAtomHandler(() => (githubCalls += 1)));

    const url = `https://example.com/feed/${encodeFeedConfig(starredConfig)}`;
    const first = await fetchApp(url);
    const firstBody = await first.text();
    const second = await fetchApp(url);
    const secondBody = await second.text();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody).toBe(firstBody);
    expect(githubCalls).toBe(1);
  });

  it(
    "serves the cached snapshot with Retry-After when GitHub rate limits",
    // The mocked retry-after of 1s is retried twice, so this path takes ~2s.
    { timeout: 6_000 },
    async () => {
      const cache = installFakeCache();

      server.use(releasesAtomHandler());

      const url = `https://example.com/feed/${encodeFeedConfig(starredConfig)}`;
      const first = await fetchApp(url);

      expect(first.status).toBe(200);

      // Evict the rendered feed but keep the long-lived snapshot, so the next
      // request must regenerate and hit the rate limit.
      cache.store.delete(url);
      server.use(
        http.get(
          "https://github.com/example/repo/releases.atom",
          () =>
            new HttpResponse("rate limited", {
              status: 429,
              headers: { "retry-after": "1" },
            }),
        ),
      );

      const second = await fetchApp(url);
      const body = await second.text();

      expect(second.status).toBe(200);
      expect(second.headers.get("Retry-After")).toBe("1");
      expect(body).toContain("[example/repo] Release: v1.0.0");
    },
  );
});

describe("GET /api/topics", () => {
  it("validates topics via the GitHub topics API", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", () =>
        HttpResponse.json({
          items: [
            {
              name: "web-components",
              display_name: "Web Components",
              short_description: "Web component tooling",
            },
          ],
        }),
      ),
    );

    const response = await fetchApp("https://example.com/api/topics/validate?q=web-components");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      exists: true,
      name: "web-components",
    });
  });

  it("reports non-existent topics without a match", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", () => HttpResponse.json({ items: [] })),
    );

    const response = await fetchApp("https://example.com/api/topics/validate?q=nonexistent");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      exists: false,
      name: null,
    });
  });

  it("rejects invalid topic slugs before any GitHub call is made", async () => {
    const calls = recordGitHubCalls();
    const response = await fetchApp("https://example.com/api/topics/validate?q=Bad_Slug");

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns featured topics with a 24 hour cache header", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", () =>
        HttpResponse.json({
          items: [
            {
              name: "javascript",
              display_name: "JavaScript",
              short_description: "A scripting language",
            },
          ],
        }),
      ),
    );

    const response = await fetchApp("https://example.com/api/topics/featured");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(payload[0].name).toBe("javascript");
  });
});

describe("adaptive feed experiment", () => {
  it("fails closed with no-store when Flagship is unavailable", async () => {
    const response = await fetchApp("https://example.com/api/experiments", {
      headers: { "X-Experiment-Key": experimentKey },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ adaptiveFeedBuilder: false });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("evaluates the Flagship flag with a sticky key and preview surface", async () => {
    const { bindings, getBooleanValue } = makeAssistantEnv();
    const response = await fetchApp(
      "https://worker.example.com/api/experiments",
      {
        headers: {
          Origin: "https://feature-branch.ossreleasefeed.pages.dev",
          "X-Experiment-Key": experimentKey,
        },
      },
      bindings,
    );

    await expect(response.json()).resolves.toEqual({ adaptiveFeedBuilder: true });
    expect(getBooleanValue).toHaveBeenCalledWith("adaptive-feed-builder", false, {
      experimentKey,
      surface: "preview",
    });
  });

  it("permits the assistant CORS preflight and experiment-key header locally", async () => {
    const response = await fetchApp("http://127.0.0.1:8787/api/assistant/turn", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-experiment-key",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Experiment-Key");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
  });
});

describe("POST /api/assistant/turn", () => {
  const postAssistant = (
    body: unknown,
    bindings: WorkerBindings,
    extraHeaders: Record<string, string> = {},
  ) =>
    fetchApp(
      "http://127.0.0.1:8787/api/assistant/turn",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:5173",
          "Content-Type": "application/json",
          "X-Experiment-Key": experimentKey,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      },
      bindings,
    );

  it("returns 404 before inference when the runtime flag is disabled", async () => {
    const { bindings, run } = makeAssistantEnv({ enabled: false });
    const response = await postAssistant(assistantRequest("Create a CSS feed"), bindings);

    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("creates a validated canonical topic feed URL", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", ({ request }) => {
        const topic = new URL(request.url).searchParams.get("q") ?? "";

        return HttpResponse.json({
          items: [{ name: topic, display_name: topic, short_description: null }],
        });
      }),
    );
    const { bindings, run, clientLimit, networkLimit } = makeAssistantEnv();
    const response = await postAssistant(
      assistantRequest(
        "Create a feed for CSS, JavaScript, and TypeScript that updates every 24 hours.",
      ),
      bindings,
    );
    const payload = await response.json();
    const expectedToken = encodeFeedConfig({
      source: "topics",
      topics: ["css", "javascript", "typescript"],
      topicOperator: "or",
      activityType: "releases",
      ttl: 86400,
      format: "atom",
    });

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "ready",
      draft: {
        source: "topics",
        topics: ["css", "javascript", "typescript"],
        ttl: 86400,
      },
      issues: [],
      feedUrl: `http://127.0.0.1:8787/feed/${expectedToken}`,
      showUi: true,
      ttlSelected: true,
    });
    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct-fast",
      expect.objectContaining({
        temperature: 0,
        response_format: expect.objectContaining({ type: "json_schema" }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(clientLimit).toHaveBeenCalledWith({ key: experimentKey });
    expect(networkLimit).toHaveBeenCalledWith({ key: "unknown-network" });
  });

  it("sends the conversation history as chat messages and the current turn separately", async () => {
    const { bindings, run } = makeAssistantEnv({
      aiResponse: {
        intent: "list-settings",
        proposedState: "edit-settings",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      {
        message: "list available options",
        history: [
          { role: "user", content: "I want a CSS feed" },
          {
            role: "assistant",
            content:
              "I selected the topic css. Next, choose how often the feed should update. I can show you the settings UI or list the available options.",
          },
        ],
        state: "edit-settings",
        draft: { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
        issues: [],
        ttlSelected: false,
      },
      bindings,
    );

    expect(response.status).toBe(200);
    const [, input] = run.mock.calls[0] as [
      string,
      { messages: Array<{ role: string; content: string }> },
    ];
    expect(input.messages).toHaveLength(4);
    expect(input.messages[1]).toEqual({ role: "user", content: "I want a CSS feed" });
    expect(input.messages[2]).toEqual({
      role: "user",
      content:
        "[Previous assistant response] I selected the topic css. Next, choose how often the feed should update. I can show you the settings UI or list the available options.",
    });
    expect(JSON.parse(input.messages[3].content)).toEqual({
      message: "list available options",
      state: "edit-settings",
      draft: { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
    });
  });

  it("rejects an invalid model decision without validating topics", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: { source: "topics", topics: ["css"] },
        unexpected: "field",
      },
    });
    const response = await postAssistant(assistantRequest("Create a CSS feed"), bindings);

    expect(response.status).toBe(502);
    expect(githubCalls).toHaveLength(0);
  });

  it("rejects an illegal model state transition without validating topics", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "enter-username",
        draftPatch: {
          source: "topics",
          topics: ["css"],
          activityType: "releases",
          ttl: 3600,
        },
      },
    });
    const response = await postAssistant(
      { ...assistantRequest("Create a CSS feed"), state: "edit-topics" as const },
      bindings,
    );

    expect(response.status).toBe(502);
    expect(githubCalls).toHaveLength(0);
  });

  it("returns to topic editing and no URL for a missing GitHub topic", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", () => HttpResponse.json({ items: [] })),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: { source: "topics", topics: ["not-a-real-topic"] },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a not-a-real-topic feed"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.state).toBe("edit-topics");
    expect(payload.feedUrl).toBeNull();
    expect(payload.issues).toEqual(["Check: not-a-real-topic"]);
  });

  it("answers capability questions without inventing a feed", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings, run } = makeAssistantEnv({
      aiResponse: {
        intent: "explain-capabilities",
        proposedState: "choose-source",
        draftPatch: {},
      },
    });
    const response = await postAssistant(assistantRequest("What feeds can I create"), bindings);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.state).toBe("choose-source");
    expect(payload.feedUrl).toBeNull();
    expect(payload.showUi).toBe(false);
    expect(payload.message).toContain("GitHub topic");
    expect(run).toHaveBeenCalledOnce();
    expect(githubCalls).toHaveLength(0);
  });

  it("lists current featured topics conversationally without revealing controls", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", () =>
        HttpResponse.json({
          items: [
            { name: "css", display_name: "CSS", short_description: null },
            { name: "typescript", display_name: "TypeScript", short_description: null },
            { name: "compiler", display_name: "Compiler", short_description: null },
            { name: "awesome-lists", display_name: "Awesome Lists", short_description: null },
          ],
        }),
      ),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "list-topics",
        proposedState: "edit-topics",
        draftPatch: { source: "topics" },
      },
    });
    const response = await postAssistant(assistantRequest("What topics are available?"), bindings);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "edit-topics",
      draft: { source: "topics", topics: [] },
      issues: [],
      feedUrl: null,
      showUi: false,
    });
    expect(payload.message).toContain("CSS, TypeScript, Compiler, Awesome Lists");
    expect(payload.message).toContain("specify your own");
  });

  it("uses fallback copy when no featured topics are available", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", () => HttpResponse.json({ items: [] })),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "list-topics",
        proposedState: "edit-topics",
        draftPatch: { source: "topics" },
      },
    });
    const response = await postAssistant(assistantRequest("What topics are available?"), bindings);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe(
      "Featured topics are temporarily unavailable. You can still specify any GitHub topic.",
    );
  });

  it("lists update frequencies before a topic is selected without changing state", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "list-settings",
        proposedState: "edit-settings",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      assistantRequest("What update frequencies are available?"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "idle",
      draft: { source: null, topics: [] },
      issues: [],
      feedUrl: null,
      showUi: false,
      ttlSelected: false,
    });
    expect(payload.message).toContain("1 hour, 6 hours, 24 hours, or 1 week");
    expect(githubCalls).toHaveLength(0);
  });

  it("lists update frequencies conversationally without revealing controls", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "list-settings",
        proposedState: "edit-settings",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      {
        ...assistantRequest("List the update frequency options"),
        state: "edit-settings",
        draft: { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
      },
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "edit-settings",
      issues: [],
      feedUrl: null,
      showUi: false,
    });
    expect(payload.message).toContain("1 hour, 6 hours, 24 hours, or 1 week");
    expect(payload.message).toContain("show the settings UI");
    expect(githubCalls).toHaveLength(0);
  });

  it("confirms selected topics and explains the next decision without revealing controls", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", ({ request }) => {
        const topic = new URL(request.url).searchParams.get("q") ?? "";

        return HttpResponse.json({
          items: [{ name: topic, display_name: topic, short_description: null }],
        });
      }),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "edit-topics",
        draftPatch: { source: "topics", topics: ["css", "javascript", "typescript"] },
      },
    });
    const response = await postAssistant(
      assistantRequest("Use CSS, JavaScript, and TypeScript"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "edit-settings",
      draft: { topics: ["css", "javascript", "typescript"] },
      issues: [],
      feedUrl: null,
      showUi: false,
    });
    expect(payload.message).toContain("I selected 3 topics");
    expect(payload.message).toContain("choose how often the feed should update");
    expect(payload.message).toContain("show you the settings UI or list the available options");
  });

  it("reveals trusted components for the current conversation state on request", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "show-ui",
        proposedState: "edit-topics",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      {
        ...assistantRequest("Show UI"),
        state: "edit-topics",
        draft: { ...DEFAULT_FEED_DRAFT, source: "topics" },
        issues: ["Include at least one topic."],
      },
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "edit-topics",
      draft: { source: "topics", topics: [] },
      issues: ["Include at least one topic."],
      feedUrl: null,
      showUi: true,
    });
    expect(githubCalls).toHaveLength(0);
  });

  it("reveals the username field when UI is requested for a starred draft", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "show-ui",
        proposedState: "recoverable-error",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      {
        ...assistantRequest("Show UI"),
        state: "recoverable-error",
        draft: { ...DEFAULT_FEED_DRAFT, source: "starred" },
      },
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "enter-username",
      draft: { source: "starred", username: null },
      issues: [],
      feedUrl: null,
      showUi: true,
    });
    expect(githubCalls).toHaveLength(0);
  });

  it("reveals the repository picker when UI is requested for a starred username", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "show-ui",
        proposedState: "recoverable-error",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      {
        ...assistantRequest("Show UI"),
        state: "recoverable-error",
        draft: { ...DEFAULT_FEED_DRAFT, source: "starred", username: "octocat" },
      },
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "choose-repos",
      draft: { source: "starred", username: "octocat" },
      issues: [],
      feedUrl: null,
      showUi: true,
    });
    expect(githubCalls).toHaveLength(0);
  });

  it("asks for topics without revealing controls for an incomplete topic request", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "edit-topics",
        draftPatch: { source: "topics", topics: [] },
      },
    });
    const response = await postAssistant(assistantRequest("I want a topic feed"), bindings);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "edit-topics",
      draft: { source: "topics", topics: [] },
      issues: [],
      feedUrl: null,
      showUi: false,
    });
    expect(githubCalls).toHaveLength(0);
  });

  it("applies and revalidates a correction to an existing topic feed", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", ({ request }) => {
        const topic = new URL(request.url).searchParams.get("q") ?? "";

        return HttpResponse.json({
          items: [{ name: topic, display_name: topic, short_description: null }],
        });
      }),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: { topics: ["typescript"], ttl: 86400 },
      },
    });
    const response = await postAssistant(
      {
        message: "Use TypeScript instead and update every 24 hours",
        history: [
          { role: "user", content: "Create a CSS feed" },
          { role: "assistant", content: "Your topic feed is ready." },
        ],
        state: "ready",
        draft: {
          ...DEFAULT_FEED_DRAFT,
          source: "topics",
          topics: ["css"],
        },
        issues: [],
        ttlSelected: true,
      },
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "ready",
      draft: { topics: ["typescript"], ttl: 86400 },
      issues: [],
    });
    expect(payload.feedUrl).toContain("/feed/");
  });

  it("reaches ready on a later turn after an interval was explicitly selected", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", ({ request }) => {
        const topic = new URL(request.url).searchParams.get("q") ?? "";

        return HttpResponse.json({
          items: [{ name: topic, display_name: topic, short_description: null }],
        });
      }),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      {
        ...assistantRequest("Generate the feed"),
        state: "edit-settings",
        draft: {
          ...DEFAULT_FEED_DRAFT,
          source: "topics",
          topics: ["css"],
          ttl: 86400,
        },
        ttlSelected: true,
      },
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "ready",
      draft: { topics: ["css"], ttl: 86400 },
      ttlSelected: true,
      showUi: true,
    });
    expect(payload.feedUrl).toContain("/feed/");
  });

  it("validates topics before offering supported settings for an unsupported interval", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", ({ request }) => {
        const topic = new URL(request.url).searchParams.get("q") ?? "";

        return HttpResponse.json({
          items: [{ name: topic, display_name: topic, short_description: null }],
        });
      }),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "unsupported",
        proposedState: "edit-settings",
        draftPatch: { source: "topics", topics: ["css"] },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a CSS feed that updates every 12 hours"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "edit-settings",
      draft: { source: "topics", topics: ["css"] },
      issues: ["Choose 1 hour, 6 hours, 24 hours, or 1 week."],
      feedUrl: null,
    });
  });

  it("fails safely when GitHub topic validation is unavailable", async () => {
    server.use(
      http.get("https://api.github.com/search/topics", () =>
        HttpResponse.json({ message: "Service unavailable" }, { status: 503 }),
      ),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: { source: "topics", topics: ["css"] },
      },
    });
    const response = await postAssistant(assistantRequest("Create a CSS feed"), bindings);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Topic validation temporarily unavailable",
    });
  });

  it("applies both rate limits before invoking Workers AI", async () => {
    const { bindings, run, clientLimit, networkLimit } = makeAssistantEnv({
      clientAllowed: false,
    });
    const response = await postAssistant(assistantRequest("Create a CSS feed"), bindings);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(clientLimit).toHaveBeenCalledOnce();
    expect(networkLimit).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects unknown request fields before invoking Workers AI", async () => {
    const { bindings, run } = makeAssistantEnv();
    const response = await postAssistant(
      { ...assistantRequest("Create a CSS feed"), unknown: true },
      bindings,
    );

    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body before invoking Workers AI", async () => {
    const { bindings, run } = makeAssistantEnv();
    const response = await postAssistant({ message: "x".repeat(9_000) }, bindings);

    expect(response.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 503 without invoking inference when the AI binding is missing", async () => {
    const { bindings, run } = makeAssistantEnv();
    const response = await postAssistant(assistantRequest("Create a CSS feed"), {
      ...bindings,
      AI: undefined,
    });

    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 408 when inference is aborted", async () => {
    const abortError = new Error("The request was aborted");
    abortError.name = "AbortError";
    const { bindings, run } = makeAssistantEnv({ aiError: abortError });
    const response = await postAssistant(assistantRequest("Create a CSS feed"), bindings);

    expect(response.status).toBe(408);
    expect(run).toHaveBeenCalledOnce();
  });

  const octocatUserHandler = ({ found = true }: { found?: boolean } = {}) =>
    http.get("https://api.github.com/users/octocat", () =>
      found
        ? HttpResponse.json({ login: "octocat" })
        : HttpResponse.json({ message: "Not Found" }, { status: 404 }),
    );

  const octocatStarsHandler = (repos: unknown[] = [repoFixture]) =>
    http.get("https://api.github.com/users/octocat/starred", () => HttpResponse.json(repos));

  const expectValidFeedToken = (token: string) => {
    const decoded = decodeFeedConfig(token);

    if (!Either.isRight(decoded)) {
      throw new Error("Expected a valid starred feed token");
    }

    return decoded.right;
  };

  it("asks for a GitHub username when a starred request has none", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "enter-username",
        draftPatch: { source: "starred" },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a feed from my starred repositories"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "enter-username",
      draft: { source: "starred", username: null },
      issues: [],
      feedUrl: null,
      showUi: false,
    });
    expect(payload.message).toContain("Which GitHub username");
    expect(githubCalls).toHaveLength(0);
  });

  it("validates a username and asks whether to use all starred repositories", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([repoFixture]));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "enter-username",
        draftPatch: { source: "starred", username: "octocat" },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a feed from octocat's starred repositories"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "choose-repos",
      draft: { source: "starred", username: "octocat", repoSelection: null },
      issues: [],
      feedUrl: null,
      showUi: false,
    });
    expect(payload.message).toContain("Found @octocat");
    expect(payload.message).toContain("all of their starred repositories or a specific selection");
  });

  it("reports an unknown GitHub username", async () => {
    server.use(octocatUserHandler({ found: false }));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "enter-username",
        draftPatch: { source: "starred", username: "octocat" },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a feed from octocat's starred repositories"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "enter-username",
      draft: { source: "starred", username: "octocat" },
      feedUrl: null,
    });
    expect(payload.issues).toEqual(["No GitHub user found with the username “octocat”."]);
  });

  it("reports a GitHub user with no starred repositories", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([]));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "enter-username",
        draftPatch: { source: "starred", username: "octocat" },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a feed from octocat's starred repositories"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.state).toBe("enter-username");
    expect(payload.issues).toEqual(["@octocat has no public starred repositories."]);
  });

  it("generates an all-starred feed URL in one turn", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([repoFixture]));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: {
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "all" },
          ttl: 86400,
        },
      },
    });
    const response = await postAssistant(
      assistantRequest("All of octocat's starred repositories, updating every 24 hours"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "ready",
      draft: {
        source: "starred",
        username: "octocat",
        repoSelection: { kind: "all" },
        ttl: 86400,
      },
      showUi: true,
      ttlSelected: true,
    });
    const token = new URL(payload.feedUrl).pathname.replace("/feed/", "");

    expect(expectValidFeedToken(token)).toMatchObject({
      source: "starred",
      username: "octocat",
      repos: null,
      ttl: 86400,
    });
  });

  it("reports repositories that are not in the user's starred list", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([repoFixture]));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: {
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "subset", repos: ["example/repo", "not-starred/repo"] },
          ttl: 86400,
        },
      },
    });
    const response = await postAssistant(
      assistantRequest("Follow example/repo and not-starred/repo from octocat"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "choose-repos",
      draft: {
        source: "starred",
        username: "octocat",
        repoSelection: { kind: "subset", repos: ["example/repo"] },
      },
      feedUrl: null,
    });
    expect(payload.issues).toEqual([
      "“not-starred/repo” is not among @octocat's starred repositories.",
    ]);
  });

  it("generates a subset starred feed URL after validating the selection", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([repoFixture]));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: {
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "subset", repos: ["example/repo"] },
          ttl: 86400,
        },
      },
    });
    const response = await postAssistant(
      assistantRequest("Follow example/repo from octocat, updating every 24 hours"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.state).toBe("ready");
    const token = new URL(payload.feedUrl).pathname.replace("/feed/", "");

    expect(expectValidFeedToken(token)).toMatchObject({
      source: "starred",
      username: "octocat",
      repos: ["example/repo"],
      ttl: 86400,
    });
  });

  it("lists update frequencies for a starred draft in the repository state", async () => {
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "list-settings",
        proposedState: "edit-settings",
        draftPatch: {},
      },
    });
    const response = await postAssistant(
      {
        ...assistantRequest("What update frequencies are available?"),
        state: "choose-repos",
        draft: {
          ...DEFAULT_FEED_DRAFT,
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "all" },
        },
      },
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "choose-repos",
      draft: { source: "starred", username: "octocat", repoSelection: { kind: "all" } },
      feedUrl: null,
      showUi: false,
    });
    expect(payload.message).toContain("1 hour, 6 hours, 24 hours, or 1 week");
    expect(githubCalls).toHaveLength(0);
  });

  it("keeps an all-starred feed in choose-repos until a frequency is selected", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([repoFixture]));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "choose-repos",
        draftPatch: {
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "all" },
        },
      },
    });
    const response = await postAssistant(
      assistantRequest("All of octocat's starred repositories"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "choose-repos",
      draft: { repoSelection: { kind: "all" } },
      feedUrl: null,
      ttlSelected: false,
    });
    expect(payload.message).toContain("choose how often the feed should update");
  });

  it("guides update-frequency selection when a starred interval is unsupported", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([repoFixture]));
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "unsupported",
        proposedState: "choose-repos",
        draftPatch: { source: "starred", username: "octocat" },
      },
    });
    const response = await postAssistant(
      assistantRequest("octocat's starred repos updating every 12 hours"),
      bindings,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "choose-repos",
      draft: { source: "starred", username: "octocat" },
      feedUrl: null,
    });
    expect(payload.issues).toEqual(["Choose 1 hour, 6 hours, 24 hours, or 1 week."]);
  });

  it("returns 503 when GitHub is unavailable during starred validation", async () => {
    server.use(
      http.get("https://api.github.com/users/octocat", () =>
        HttpResponse.json({ message: "boom" }, { status: 503 }),
      ),
    );
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "enter-username",
        draftPatch: { source: "starred", username: "octocat" },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a feed from octocat's starred repositories"),
      bindings,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Starred repository lookup temporarily unavailable",
    });
  });

  it("rejects a starred ready state proposed without a selection", async () => {
    server.use(octocatUserHandler(), octocatStarsHandler([repoFixture]));
    const githubCalls = recordGitHubCalls();
    const { bindings } = makeAssistantEnv({
      aiResponse: {
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: { source: "starred", username: "octocat" },
      },
    });
    const response = await postAssistant(
      assistantRequest("Create a feed from octocat's starred repositories"),
      bindings,
    );

    expect(response.status).toBe(502);
    expect(githubCalls).toHaveLength(0);
  });
});

describe("GET /api/users/validate/:username", () => {
  it("returns existence and star data for a valid username", async () => {
    server.use(
      http.get("https://api.github.com/users/octocat", () =>
        HttpResponse.json({ login: "octocat" }),
      ),
      http.get("https://api.github.com/users/octocat/starred", () =>
        HttpResponse.json([repoFixture]),
      ),
    );

    const response = await fetchApp("https://example.com/api/users/validate/octocat");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      exists: true,
      username: "octocat",
      hasStars: true,
    });
  });

  it("reports unknown usernames as not existing", async () => {
    server.use(
      http.get("https://api.github.com/users/ghost", () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
      ),
    );

    const response = await fetchApp("https://example.com/api/users/validate/ghost");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      exists: false,
      username: null,
      hasStars: false,
    });
  });

  it("rejects invalid usernames before any GitHub call is made", async () => {
    const calls = recordGitHubCalls();
    const response = await fetchApp("https://example.com/api/users/validate/Bad_Name");

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /api/starred/:username", () => {
  it("returns starred repositories for a valid username", async () => {
    server.use(
      http.get("https://api.github.com/users/octocat/starred", () =>
        HttpResponse.json([repoFixture]),
      ),
    );

    const response = await fetchApp("https://example.com/api/starred/octocat");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toHaveLength(1);
    expect(payload[0].full_name).toBe("example/repo");
  });

  it("returns 404 for unknown usernames", async () => {
    server.use(
      http.get("https://api.github.com/users/ghost/starred", () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
      ),
    );

    const response = await fetchApp("https://example.com/api/starred/ghost");

    expect(response.status).toBe(404);
  });

  it("rejects path traversal attempts before any GitHub call is made", async () => {
    const calls = recordGitHubCalls();
    const response = await fetchApp("https://example.com/api/starred/..%2F..%2Fsecrets");

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("CORS", () => {
  const topicsHandler = http.get("https://api.github.com/search/topics", () =>
    HttpResponse.json({ items: [] }),
  );

  it("allows Pages preview origins on /api routes", async () => {
    server.use(topicsHandler);

    const origin = "https://feature-branch.ossreleasefeed.pages.dev";
    const response = await app.fetch(
      new Request("https://example.com/api/topics/validate?q=web-components", {
        headers: { Origin: origin },
      }),
      env,
      executionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  it("does not allow unknown origins on /api routes", async () => {
    server.use(topicsHandler);

    const response = await app.fetch(
      new Request("https://example.com/api/topics/validate?q=web-components", {
        headers: { Origin: "https://evil.example" },
      }),
      env,
      executionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not add CORS headers to /feed routes", async () => {
    const response = await app.fetch(
      new Request("https://example.com/feed/not-valid", {
        headers: { Origin: "https://feature-branch.ossreleasefeed.pages.dev" },
      }),
      env,
      executionContext,
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("security headers", () => {
  it("attaches security headers to every response", async () => {
    const response = await fetchApp("https://example.com/feed/not-valid");

    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
