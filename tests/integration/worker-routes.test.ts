import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../../worker/src/index";
import { encodeFeedConfig } from "../../worker/src/lib/config";
import type { FeedConfig } from "../../worker/src/lib/schemas";
import { server } from "./setup";

const env = {
  APP_NAME: "ossreleasefeed",
  GITHUB_PAT: "test-token",
};

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
} as ExecutionContext;

const fetchApp = (url: string) => app.fetch(new Request(url), env, executionContext);

const encodeRawConfig = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

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
});

describe("GET /feed/:config", () => {
  it("returns atom feed output for a valid starred release config", async () => {
    server.use(releasesAtomHandler());

    const response = await fetchApp(`https://example.com/feed/${encodeFeedConfig(starredConfig)}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/atom+xml");
    expect(body).toContain("[example/repo] Release: v1.0.0");
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

  it("returns 503 when GitHub is unavailable and no cached feed exists", async () => {
    server.use(
      http.get(
        "https://github.com/example/repo/releases.atom",
        () => new HttpResponse("upstream error", { status: 500 }),
      ),
    );

    const response = await fetchApp(`https://example.com/feed/${encodeFeedConfig(starredConfig)}`);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toBe("GitHub temporarily unavailable");
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
    { timeout: 15_000 },
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
