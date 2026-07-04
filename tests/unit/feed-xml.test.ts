import { describe, expect, it } from "vitest";
import { buildFeed } from "../../worker/src/feed/build";
import { parseCachedFeed, parseGitHubReleaseAtom } from "../../worker/src/feed/xml";
import { FeedParseError } from "../../worker/src/lib/errors";
import type { FeedConfig, FeedEntry } from "../../worker/src/lib/schemas";

const sourceUrl = "https://github.com/example/repo/releases.atom";

const releaseAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:github.com,2008:https://github.com/example/repo/releases</id>
  <title>Release notes from repo</title>
  <entry>
    <id>tag:github.com,2008:Repository/123/v2.0.0</id>
    <updated>2026-03-01T10:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/example/repo/releases/tag/v2.0.0"/>
    <title>v2.0.0</title>
    <content type="html">&lt;p&gt;Fixes &amp;amp; features&lt;/p&gt;</content>
    <author><name>octocat</name></author>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/123/v1.0.0</id>
    <updated>2026-02-01T10:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/example/repo/releases/tag/v1.0.0"/>
    <title>v1.0.0</title>
    <content type="html">First release</content>
  </entry>
</feed>`;

describe("parseGitHubReleaseAtom", () => {
  it("uses the alternate link URL as the entry id, not GitHub's tag URI", async () => {
    const entries = await parseGitHubReleaseAtom(releaseAtom, "example/repo", sourceUrl);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("https://github.com/example/repo/releases/tag/v2.0.0");
    expect(entries[0].link).toBe(entries[0].id);
    expect(entries[0].repo).toBe("example/repo");
    expect(entries[0].entryType).toBe("release");
  });

  it("returns entity-decoded HTML content", async () => {
    const entries = await parseGitHubReleaseAtom(releaseAtom, "example/repo", sourceUrl);

    expect(entries[0].summary).toBe("<p>Fixes &amp; features</p>");
  });

  it("skips entries missing required fields instead of failing", async () => {
    const entries = await parseGitHubReleaseAtom(releaseAtom, "example/repo", sourceUrl);

    expect(entries.map((entry) => entry.title)).toEqual(["v2.0.0"]);
  });

  it("rejects with FeedParseError on an unparseable date", async () => {
    const badDate = releaseAtom.replace("2026-03-01T10:00:00Z", "not-a-date");

    await expect(parseGitHubReleaseAtom(badDate, "example/repo", sourceUrl)).rejects.toBeInstanceOf(
      FeedParseError,
    );
  });

  it("rejects with FeedParseError on malformed XML", async () => {
    await expect(
      parseGitHubReleaseAtom("<feed><entry></feed>", "example/repo", sourceUrl),
    ).rejects.toBeInstanceOf(FeedParseError);
  });
});

describe("parseCachedFeed", () => {
  const config: FeedConfig = {
    source: "starred",
    username: "octocat",
    repos: ["example/repo"],
    activityType: "all",
    ttl: 3600,
    format: "atom",
  };

  const entries: FeedEntry[] = [
    {
      id: "https://github.com/example/repo/releases/tag/v2.0.0",
      link: "https://github.com/example/repo/releases/tag/v2.0.0",
      title: "v2.0.0",
      summary: "<p>Second release</p>",
      date: new Date("2026-03-01T10:00:00.000Z"),
      authorLogin: "octocat",
      repo: "example/repo",
      entryType: "release",
    },
    {
      id: "https://github.com/example/repo/pull/42",
      link: "https://github.com/example/repo/pull/42",
      title: "Fix crash on empty feed",
      summary: "",
      date: new Date("2026-02-15T10:00:00.000Z"),
      authorLogin: "contributor",
      repo: "example/repo",
      entryType: "pull_request",
    },
  ];

  it("round-trips entries produced by buildFeed", () => {
    const feedUrl = "https://feeds.example.com/feed/abc123";
    const xml = buildFeed(config, entries, feedUrl, "ossreleasefeed").atom1();
    const parsed = parseCachedFeed(xml, feedUrl);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].link).toBe(entries[0].link);
    expect(parsed[0].title).toBe("v2.0.0");
    expect(parsed[0].repo).toBe("example/repo");
    expect(parsed[0].entryType).toBe("release");
    expect(parsed[0].date.getTime()).toBe(entries[0].date.getTime());
    expect(parsed[1].entryType).toBe("pull_request");
    expect(parsed[1].title).toBe("Fix crash on empty feed");
  });
});
