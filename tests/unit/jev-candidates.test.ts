import { describe, expect, it } from "vitest";
import {
  candidatesFor,
  parseFirstCount,
  parseFrequency,
  topicCandidates,
  usernameCandidates,
} from "../../worker/src/assistant/interpreter/jev/candidates";

describe("parseFrequency", () => {
  it("parses a plain quantified duration", () => {
    expect(parseFrequency("Update every 24 hours")).toEqual({ kind: "supported", ttl: 86400 });
  });

  it("parses 'every N hours'", () => {
    expect(parseFrequency("every 6 hours")).toEqual({ kind: "supported", ttl: 21600 });
  });

  it("parses 'Once a week'", () => {
    expect(parseFrequency("Once a week")).toEqual({ kind: "supported", ttl: 604800 });
  });

  it("parses the 'daily' adverb", () => {
    expect(parseFrequency("Refresh the feed daily")).toEqual({ kind: "supported", ttl: 86400 });
  });

  it("parses the 'hourly' adverb", () => {
    expect(parseFrequency("hourly please")).toEqual({ kind: "supported", ttl: 3600 });
  });

  it("parses the 'weekly' adverb", () => {
    expect(parseFrequency("weekly is fine")).toEqual({ kind: "supported", ttl: 604800 });
  });

  it("parses 'every day'", () => {
    expect(parseFrequency("check every day")).toEqual({ kind: "supported", ttl: 86400 });
  });

  it("parses a spelled-out number word", () => {
    expect(parseFrequency("twenty-four hours between refreshes")).toEqual({
      kind: "supported",
      ttl: 86400,
    });
  });

  it("flags an interval that is not one of the supported ttls", () => {
    expect(parseFrequency("Update every 12 hours")).toEqual({ kind: "unsupported" });
  });

  it("flags 30 minutes as unsupported", () => {
    expect(parseFrequency("refresh every 30 minutes")).toEqual({ kind: "unsupported" });
  });

  it("flags 'twice a day' as unsupported", () => {
    expect(parseFrequency("twice a day works for me")).toEqual({ kind: "unsupported" });
  });

  it("returns null when no frequency is mentioned", () => {
    expect(parseFrequency("Show me the current settings")).toBeNull();
  });

  it("does not confuse a first-N request with a frequency", () => {
    expect(parseFrequency("Select the first 10")).toBeNull();
  });
});

describe("parseFirstCount", () => {
  it("parses 'first N'", () => {
    expect(parseFirstCount("Select the first 10")).toBe(10);
  });

  it("parses a spelled-out count", () => {
    expect(parseFirstCount("just the first two, please")).toBe(2);
  });

  it("parses 'top N'", () => {
    expect(parseFirstCount("give me the top 5")).toBe(5);
  });

  it("rejects a count of zero", () => {
    expect(parseFirstCount("the first 0")).toBeNull();
  });

  it("rejects a count above 25", () => {
    expect(parseFirstCount("the first 26")).toBeNull();
  });

  it("rejects a wildly out of range count", () => {
    expect(parseFirstCount("the first 100")).toBeNull();
  });

  it("returns null when nothing is asked for", () => {
    expect(parseFirstCount("show me all of octocat's repositories")).toBeNull();
  });
});

describe("topicCandidates", () => {
  it("produces every n-gram up to three words with correct spans", () => {
    const candidates = topicCandidates("I want to follow machine learning topics", [], []);
    const bySlug = Object.fromEntries(candidates.map((candidate) => [candidate.slug, candidate]));

    expect(bySlug.machine).toEqual({ slug: "machine", span: [4, 4] });
    expect(bySlug.learning).toEqual({ slug: "learning", span: [5, 5] });
    expect(bySlug["machine-learning"]).toEqual({ slug: "machine-learning", span: [4, 5] });
    // "topics" is a stop word, so it never extends the n-gram or appears itself.
    expect(bySlug.topics).toBeUndefined();
    expect(bySlug["learning-topics"]).toBeUndefined();
    expect(bySlug["machine-learning-topics"]).toBeUndefined();
  });

  it("keeps an already-hyphenated token as one candidate", () => {
    const candidates = topicCandidates("I like web-components a lot", [], []);

    expect(candidates.some((candidate) => candidate.slug === "web-components")).toBe(true);
  });

  it("excludes stop words and pure numbers", () => {
    const candidates = topicCandidates("please add python 3 to the feed", [], []);

    expect(candidates).toEqual([{ slug: "python", span: [2, 2] }]);
  });

  it("excludes owner/repo strings from the topic tokens", () => {
    const candidates = topicCandidates("add facebook/react topic", [], ["facebook/react"]);

    expect(candidates).toEqual([]);
    expect(candidates.some((candidate) => candidate.slug === "facebook")).toBe(false);
    expect(candidates.some((candidate) => candidate.slug === "react")).toBe(false);
  });

  it("appends existing draft topics the message does not mention, with a null span", () => {
    const candidates = topicCandidates("just rust please", ["python", "css"], []);

    expect(candidates).toEqual([
      { slug: "rust", span: [1, 1] },
      { slug: "python", span: null },
      { slug: "css", span: null },
    ]);
  });

  it("does not duplicate an existing topic the message also names", () => {
    const candidates = topicCandidates("keep python and add rust", ["python"], []);

    expect(candidates.filter((candidate) => candidate.slug === "python")).toHaveLength(1);
    expect(candidates.find((candidate) => candidate.slug === "python")?.span).toEqual([1, 1]);
  });

  it("every produced slug matches the topic slug shape", () => {
    const candidates = topicCandidates(
      "Follow rust, go, and web-components please",
      ["already-tracked"],
      [],
    );

    for (const candidate of candidates) {
      expect(candidate.slug).toMatch(/^[a-z0-9][a-z0-9-]{0,34}$/u);
    }
  });
});

describe("usernameCandidates", () => {
  it("strips a possessive suffix", () => {
    expect(usernameCandidates("octocat's starred repositories", [])).toContain("octocat");
  });

  it("strips a leading @", () => {
    expect(usernameCandidates("follow @octocat", [])).toContain("octocat");
  });

  it("strips trailing punctuation", () => {
    expect(usernameCandidates("use octocat, please.", [])).toContain("octocat");
  });

  it("excludes function words such as 'my'", () => {
    const candidates = usernameCandidates("show my starred repos", []);

    expect(candidates).not.toContain("my");
  });

  it("excludes an owner/repo string", () => {
    const candidates = usernameCandidates("add facebook/react", ["facebook/react"]);

    expect(candidates).not.toContain("facebook/react");
  });

  it("dedupes repeated mentions while preserving first-seen order", () => {
    const candidates = usernameCandidates("octocat again, not hubot, but octocat", []);

    expect(candidates.filter((candidate) => candidate === "octocat")).toHaveLength(1);
    expect(candidates.indexOf("octocat")).toBeLessThan(candidates.indexOf("hubot"));
  });
});

describe("candidatesFor", () => {
  it("combines topics, usernames, repositories, firstCount, and frequency", () => {
    const result = candidatesFor("Use octocat/spoon-knife updated every 6 hours", []);

    expect(result.repositories).toEqual(["octocat/spoon-knife"]);
    expect(result.frequency).toEqual({ kind: "supported", ttl: 21600 });
    expect(result.firstCount).toBeNull();
    // The owner/repo text is stripped before candidates are derived, so
    // "octocat" never surfaces as a standalone username candidate.
    expect(result.usernames).not.toContain("octocat");
  });

  it("carries existing topics through to the combined candidates", () => {
    const result = candidatesFor("switch to rust", ["python"]);

    expect(result.topics).toEqual(
      expect.arrayContaining([
        { slug: "rust", span: expect.any(Array) },
        { slug: "python", span: null },
      ]),
    );
  });
});
