import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  FeedEntrySchema,
  GithubUsernameSchema,
  TopicSlugSchema,
} from "../../worker/src/lib/schemas";

const decodeUsername = Schema.decodeUnknownEither(GithubUsernameSchema);
const decodeTopic = Schema.decodeUnknownEither(TopicSlugSchema);
const decodeEntry = Schema.decodeUnknownEither(FeedEntrySchema);

describe("GithubUsernameSchema", () => {
  it.each(["octocat", "a", "A1", "octo-cat", "a".repeat(39)])("accepts %s", (username) => {
    expect(Either.isRight(decodeUsername(username))).toBe(true);
  });

  it.each([
    "",
    "Bad_Name",
    "-octocat",
    "octocat-",
    "octo cat",
    "a".repeat(40),
    "../../../etc/passwd",
    "octo/cat",
    "octo.cat",
  ])("rejects %s", (username) => {
    expect(Either.isLeft(decodeUsername(username))).toBe(true);
  });
});

describe("TopicSlugSchema", () => {
  it.each(["web-components", "a11y", "c", "rss-feeds"])("accepts %s", (slug) => {
    expect(Either.isRight(decodeTopic(slug))).toBe(true);
  });

  it.each([
    "",
    "Web-Components",
    "-leading-hyphen",
    "under_score",
    "a".repeat(36),
    "../secrets",
    "topic/slug",
  ])("rejects %s", (slug) => {
    expect(Either.isLeft(decodeTopic(slug))).toBe(true);
  });
});

describe("FeedEntrySchema", () => {
  const validEntry = {
    id: "https://github.com/example/repo/releases/tag/v1.0.0",
    link: "https://github.com/example/repo/releases/tag/v1.0.0",
    title: "v1.0.0",
    summary: "",
    date: "2026-03-01T10:00:00.000Z",
    authorLogin: "octocat",
    repo: "example/repo",
    entryType: "release",
  };

  it("accepts a valid entry and decodes the date", () => {
    const decoded = decodeEntry(validEntry);

    expect(Either.isRight(decoded)).toBe(true);

    const entry = Either.getOrThrow(decoded);

    expect(entry.date).toBeInstanceOf(Date);
    expect(entry.date.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });

  it("rejects an empty id", () => {
    expect(Either.isLeft(decodeEntry({ ...validEntry, id: "" }))).toBe(true);
  });

  it("rejects a non-URL id", () => {
    expect(Either.isLeft(decodeEntry({ ...validEntry, id: "not-a-url" }))).toBe(true);
  });

  it("rejects a non-http(s) id", () => {
    expect(Either.isLeft(decodeEntry({ ...validEntry, id: "javascript:alert(1)" }))).toBe(true);
  });

  it("rejects a missing date", () => {
    const { date: _date, ...withoutDate } = validEntry;

    expect(Either.isLeft(decodeEntry(withoutDate))).toBe(true);
  });

  it("rejects an unparseable date", () => {
    expect(Either.isLeft(decodeEntry({ ...validEntry, date: "not-a-date" }))).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(Either.isLeft(decodeEntry({ ...validEntry, title: "" }))).toBe(true);
  });

  it("rejects a repo value that is not owner/repo", () => {
    expect(Either.isLeft(decodeEntry({ ...validEntry, repo: "just-a-name" }))).toBe(true);
  });

  it("rejects an unknown entry type", () => {
    expect(Either.isLeft(decodeEntry({ ...validEntry, entryType: "commit" }))).toBe(true);
  });
});
