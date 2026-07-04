import { describe, expect, it } from "vitest";
import { diffFeed } from "../../worker/src/feed/diff";
import type { FeedEntry } from "../../worker/src/lib/schemas";

const freshEntries: FeedEntry[] = [
  {
    id: "https://github.com/example/repo/releases/tag/v2.0.0",
    link: "https://github.com/example/repo/releases/tag/v2.0.0",
    title: "v2.0.0",
    summary: "",
    date: new Date("2026-03-01T10:00:00.000Z"),
    authorLogin: "octocat",
    repo: "example/repo",
    entryType: "release",
  },
  {
    id: "https://github.com/example/repo/releases/tag/v1.0.0",
    link: "https://github.com/example/repo/releases/tag/v1.0.0",
    title: "v1.0.0",
    summary: "",
    date: new Date("2026-02-01T10:00:00.000Z"),
    authorLogin: "octocat",
    repo: "example/repo",
    entryType: "release",
  },
];

const cachedFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>[example/repo] Release: v1.0.0</title>
    <link href="https://github.com/example/repo/releases/tag/v1.0.0" />
    <updated>2026-02-01T10:00:00.000Z</updated>
    <summary></summary>
    <author>
      <name>octocat</name>
    </author>
  </entry>
</feed>`;

describe("diffFeed", () => {
  it("returns all entries when there is no cached feed", () => {
    expect(diffFeed(null, freshEntries)).toEqual(freshEntries);
  });

  it("returns only entries missing from the cached feed", () => {
    expect(diffFeed(cachedFeed, freshEntries)).toEqual([freshEntries[0]]);
  });

  it("returns an empty array when the cache already contains all links", () => {
    expect(diffFeed(cachedFeed, [freshEntries[1]])).toEqual([]);
  });
});
