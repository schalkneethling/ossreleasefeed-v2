import { describe, expect, it } from "vitest";
import { buildFeed, mergeEntries } from "../../worker/src/feed/build";
import type { FeedConfig, FeedEntry } from "../../worker/src/lib/schemas";

const feedUrl = "https://feeds.example.com/feed/abc123";

const makeEntry = (overrides: Partial<FeedEntry>): FeedEntry => ({
  id: "https://github.com/example/repo/releases/tag/v1.0.0",
  link: "https://github.com/example/repo/releases/tag/v1.0.0",
  title: "v1.0.0",
  summary: "",
  date: new Date("2026-02-01T10:00:00.000Z"),
  authorLogin: "octocat",
  repo: "example/repo",
  entryType: "release",
  ...overrides,
});

const entries: FeedEntry[] = [
  makeEntry({
    id: "https://github.com/example/repo/releases/tag/v2.0.0",
    link: "https://github.com/example/repo/releases/tag/v2.0.0",
    title: "v2.0.0",
    summary: "<p>Second release</p>",
    date: new Date("2026-03-01T10:00:00.000Z"),
  }),
  makeEntry({}),
];

const topicConfig: FeedConfig = {
  source: "topics",
  topics: ["web-components"],
  topicOperator: "or",
  activityType: "releases",
  ttl: 3600,
  format: "atom",
};

const starredConfig: FeedConfig = {
  source: "starred",
  username: "octocat",
  repos: ["example/repo"],
  activityType: "releases",
  ttl: 3600,
  format: "json",
};

describe("buildFeed", () => {
  it("produces Atom output with the feed URL as id and prefixed entry titles", () => {
    const xml = buildFeed(topicConfig, entries, feedUrl, "ossreleasefeed").atom1();

    expect(xml).toContain(`<id>${feedUrl}</id>`);
    expect(xml).toContain("ossreleasefeed: web-components");
    expect(xml).toContain("[example/repo] Release: v2.0.0");
    expect(xml).toContain("[example/repo] Release: v1.0.0");
    expect(xml).toContain("<name>octocat</name>");
  });

  it("uses the newest entry date as the feed updated timestamp", () => {
    const xml = buildFeed(topicConfig, entries, feedUrl, "ossreleasefeed").atom1();
    const updated = xml.match(/<updated>([^<]+)<\/updated>/u);

    expect(updated).not.toBeNull();
    expect(new Date(updated?.[1] ?? "").getTime()).toBe(
      new Date("2026-03-01T10:00:00.000Z").getTime(),
    );
  });

  it("titles starred feeds after the username", () => {
    const xml = buildFeed(starredConfig, entries, feedUrl, "ossreleasefeed").atom1();

    expect(xml).toContain("ossreleasefeed: octocat starred repositories");
  });

  it("produces JSON Feed output with entry links intact", () => {
    const feed = buildFeed(starredConfig, entries, feedUrl, "ossreleasefeed");
    const json = JSON.parse(feed.json1());

    expect(json.items).toHaveLength(2);
    expect(json.items[0].url).toBe("https://github.com/example/repo/releases/tag/v2.0.0");
    expect(json.items[0].title).toContain("[example/repo] Release: v2.0.0");
  });
});

describe("mergeEntries", () => {
  it("dedupes entries by link and sorts newest first", () => {
    const duplicate = makeEntry({ summary: "<p>Cached copy</p>" });
    const merged = mergeEntries([entries[1]], [duplicate, entries[0]]);

    expect(merged).toHaveLength(2);
    expect(merged[0].link).toBe("https://github.com/example/repo/releases/tag/v2.0.0");
    expect(merged[1].link).toBe("https://github.com/example/repo/releases/tag/v1.0.0");
  });
});
