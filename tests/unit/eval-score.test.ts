import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_DRAFT, type ModelDecision } from "../../worker/src/assistant/contracts";
import { buildJevQuestions } from "../../worker/src/assistant/interpreter/jev/questions";
import {
  normalizeDecision,
  percentile,
  questionSetHash,
  scoreFixture,
  staticQuestionSetHash,
  summarize,
  type FixtureResult,
} from "../eval/score";

const result = (
  id: string,
  category: string,
  pass: boolean,
  latencyMs: number | null = null,
): FixtureResult => ({
  id,
  category,
  pass,
  mismatches: pass ? [] : ["intent"],
  latencyMs,
  tokens: latencyMs === null ? null : { input: 100, output: 10 },
});

describe("normalizeDecision", () => {
  it("drops the neutral defaults the application ignores", () => {
    expect(
      normalizeDecision({
        intent: "create-or-update-feed",
        draftPatch: {
          source: "topics",
          topics: [],
          username: null,
          repoSelection: null,
          format: "atom",
          topicOperator: "or",
        },
      }),
    ).toEqual({ intent: "create-or-update-feed", draftPatch: { source: "topics" } });
  });

  it("sorts topics, and sorts repositories case-insensitively", () => {
    expect(
      normalizeDecision({
        intent: "create-or-update-feed",
        draftPatch: { topics: ["rust", "css", "go"] },
      }).draftPatch.topics,
    ).toEqual(["css", "go", "rust"]);

    expect(
      normalizeDecision({
        intent: "create-or-update-feed",
        draftPatch: {
          repoSelection: { kind: "subset", repos: ["vitejs/vite", "Microsoft/TypeScript", "a/b"] },
        },
      }).draftPatch.repoSelection,
    ).toEqual({ kind: "subset", repos: ["a/b", "Microsoft/TypeScript", "vitejs/vite"] });
  });

  it("omits absent optional keys and keeps present ones", () => {
    const informational = normalizeDecision({ intent: "list-topics", draftPatch: {} });

    expect(Object.keys(informational)).toEqual(["intent", "draftPatch"]);
    expect(
      normalizeDecision({
        intent: "unsupported",
        draftPatch: { ttl: 86400, activityType: "all" },
        unsupportedReason: "interval",
      }),
    ).toEqual({
      intent: "unsupported",
      draftPatch: { ttl: 86400, activityType: "all" },
      unsupportedReason: "interval",
    });
  });

  it("does not mutate its input", () => {
    const decision: ModelDecision = {
      intent: "create-or-update-feed",
      draftPatch: { topics: ["rust", "css"] },
    };

    normalizeDecision(decision);

    expect(decision.draftPatch.topics).toEqual(["rust", "css"]);
  });
});

describe("scoreFixture", () => {
  it("passes when decisions differ only by order and neutral defaults", () => {
    expect(
      scoreFixture(
        { intent: "create-or-update-feed", draftPatch: { topics: ["css", "rust"] } },
        {
          intent: "create-or-update-feed",
          draftPatch: { topics: ["rust", "css"], username: null, format: "atom" },
        },
      ),
    ).toEqual({ pass: true, mismatches: [] });
  });

  it("names every part that differs", () => {
    expect(
      scoreFixture(
        {
          intent: "create-or-update-feed",
          draftPatch: { source: "starred" },
          repoSelectionAction: { kind: "first", count: 3 },
        },
        { intent: "unsupported", draftPatch: {}, unsupportedReason: "request" },
      ),
    ).toEqual({
      pass: false,
      mismatches: ["intent", "draftPatch", "repoSelectionAction", "unsupportedReason"],
    });
  });

  it("treats a different first-N count as a repoSelectionAction mismatch only", () => {
    expect(
      scoreFixture(
        {
          intent: "create-or-update-feed",
          draftPatch: {},
          repoSelectionAction: { kind: "first", count: 3 },
        },
        {
          intent: "create-or-update-feed",
          draftPatch: {},
          repoSelectionAction: { kind: "first", count: 5 },
        },
      ),
    ).toEqual({ pass: false, mismatches: ["repoSelectionAction"] });
  });

  it("keeps repository name casing significant", () => {
    expect(
      scoreFixture(
        {
          intent: "create-or-update-feed",
          draftPatch: { repoSelection: { kind: "subset", repos: ["vitejs/vite"] } },
        },
        {
          intent: "create-or-update-feed",
          draftPatch: { repoSelection: { kind: "subset", repos: ["Vitejs/Vite"] } },
        },
      ).mismatches,
    ).toEqual(["draftPatch"]);
  });
});

describe("percentile", () => {
  it("uses the nearest-rank method", () => {
    const values = [50, 10, 40, 20, 30];

    expect(percentile(values, 0.5)).toBe(30);
    expect(percentile(values, 0.95)).toBe(50);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("returns null for no samples", () => {
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("summarize", () => {
  it("reports totals, per-category rates, latency, tokens, and failures", () => {
    const summary = summarize([
      result("a", "canonical", true, 100),
      result("b", "canonical", true, 300),
      result("c", "follow-up", false, 200),
      { ...result("d", "follow-up", false), errorName: "CloudflareAiError", mismatches: [] },
    ]);

    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(2);
    expect(summary.passRate).toBe(0.5);
    expect(summary.byCategory).toEqual({
      canonical: { total: 2, passed: 2, passRate: 1 },
      "follow-up": { total: 2, passed: 0, passRate: 0 },
    });
    expect(summary.latencyMs).toEqual({ p50: 200, p95: 300 });
    expect(summary.tokens).toEqual({ input: 300, output: 30 });
    expect(summary.failures).toEqual([
      { id: "c", category: "follow-up", mismatches: ["intent"], errorName: null },
      { id: "d", category: "follow-up", mismatches: [], errorName: "CloudflareAiError" },
    ]);
  });

  it("opens the overall gate at exactly 90 percent", () => {
    const nineOfTen = [
      ...Array.from({ length: 9 }, (_, index) => result(`p${index}`, "follow-up", true)),
      result("f", "follow-up", false),
    ];

    expect(summarize(nineOfTen).overallGate).toBe(true);
    expect(summarize([...nineOfTen, result("g", "correction", false)]).overallGate).toBe(false);
  });

  it("closes the critical gate on any canonical or safety failure", () => {
    const passing = Array.from({ length: 20 }, (_, index) =>
      result(`p${index}`, "follow-up", true),
    );

    expect(summarize([...passing, result("i", "informational", false)]).criticalGate).toBe(true);
    expect(summarize([...passing, result("c", "canonical", false)]).criticalGate).toBe(false);
    expect(summarize([...passing, result("s", "safety", false)]).criticalGate).toBe(false);
    expect(summarize([...passing, result("s", "safety", false)]).overallGate).toBe(true);
  });

  it("fails the overall gate for an empty run", () => {
    const summary = summarize([]);

    expect(summary.passRate).toBe(0);
    expect(summary.overallGate).toBe(false);
    expect(summary.latencyMs).toEqual({ p50: null, p95: null });
  });
});

describe("questionSetHash", () => {
  it("is a stable sha256 hex digest of the static question set", () => {
    expect(staticQuestionSetHash()).toMatch(/^[0-9a-f]{64}$/u);
    expect(staticQuestionSetHash()).toBe(staticQuestionSetHash());
  });

  it("ignores key order but not wording or example order", () => {
    const base = {
      q: {
        type: "noul" as const,
        instructions: "Is it?",
        criteria: { true: ["a", "b"], false: "no" },
      },
    };
    const reorderedKeys = {
      q: {
        criteria: { false: "no", true: ["a", "b"] },
        instructions: "Is it?",
        type: "noul" as const,
      },
    };
    const reorderedExamples = {
      q: { ...base.q, criteria: { true: ["b", "a"], false: "no" } },
    };
    const reworded = { q: { ...base.q, instructions: "Is it really?" } };

    expect(questionSetHash(reorderedKeys)).toBe(questionSetHash(base));
    expect(questionSetHash(reorderedExamples)).not.toBe(questionSetHash(base));
    expect(questionSetHash(reworded)).not.toBe(questionSetHash(base));
  });

  it("differs once per-turn questions are added", () => {
    const withTopics = buildJevQuestions(
      { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
      { topics: [], usernames: [], repositories: [], firstCount: null, frequency: null },
    );

    expect(questionSetHash(withTopics)).not.toBe(staticQuestionSetHash());
  });
});
