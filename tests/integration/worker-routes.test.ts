import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { app } from "../../worker/src/index";
import { encodeFeedConfig } from "../../worker/src/lib/config";
import { server } from "./setup";

const env = {
  APP_NAME: "ossreleasefeed",
  GITHUB_PAT: "test-token",
};

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
} as ExecutionContext;

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

describe("worker routes", () => {
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

    const response = await app.fetch(
      new Request("https://example.com/api/topics/validate?q=web-components"),
      env,
      executionContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      exists: true,
      name: "web-components",
    });
  });

  it("rejects invalid usernames before any GitHub call is made", async () => {
    const response = await app.fetch(
      new Request("https://example.com/api/users/validate/Bad_Name"),
      env,
      executionContext,
    );

    expect(response.status).toBe(400);
  });

  it("returns starred repositories for a valid username", async () => {
    server.use(
      http.get("https://api.github.com/users/octocat/starred", () =>
        HttpResponse.json([
          {
            full_name: "example/repo",
            name: "repo",
            description: "Example repository",
            stargazers_count: 42,
            owner: {
              login: "example",
            },
          },
        ]),
      ),
    );

    const response = await app.fetch(
      new Request("https://example.com/api/starred/octocat"),
      env,
      executionContext,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toHaveLength(1);
    expect(payload[0].full_name).toBe("example/repo");
  });

  it("returns atom feed output for a valid starred release config", async () => {
    server.use(
      http.get(
        "https://github.com/example/repo/releases.atom",
        () =>
          new HttpResponse(atomFixture, {
            headers: {
              "Content-Type": "application/atom+xml; charset=utf-8",
            },
          }),
      ),
    );

    const config = encodeFeedConfig({
      source: "starred",
      username: "octocat",
      repos: ["example/repo"],
      activityType: "releases",
      ttl: 3600,
      format: "atom",
    });
    const response = await app.fetch(
      new Request(`https://example.com/feed/${config}`),
      env,
      executionContext,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/atom+xml");
    expect(body).toContain("[example/repo] Release: v1.0.0");
  });

  it("returns 400 for malformed feed config tokens", async () => {
    const response = await app.fetch(
      new Request("https://example.com/feed/not-valid"),
      env,
      executionContext,
    );

    expect(response.status).toBe(400);
  });
});
