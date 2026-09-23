import { createHash } from "node:crypto";
import { canonicalizeJson } from "../../shared/canonical-json";
import {
  DEFAULT_FEED_DRAFT,
  type ModelDecision,
  type ModelDraftPatch,
} from "../../worker/src/assistant/contracts";
import { buildJevQuestions } from "../../worker/src/assistant/interpreter/jev/questions";
import type { JevQuestion } from "../../worker/src/assistant/interpreter/jev/types";

// Pure scoring for the offline evaluation: no I/O, no clock, no network.

export const OVERALL_PASS_RATE_GATE = 0.9;
export const CRITICAL_CATEGORIES: readonly string[] = ["canonical", "safety"];

const DECISION_PARTS = [
  "intent",
  "draftPatch",
  "repoSelectionAction",
  "unsupportedReason",
] as const;

export type DecisionPart = (typeof DECISION_PARTS)[number];

export type FixtureScore = {
  pass: boolean;
  mismatches: DecisionPart[];
};

export type FixtureResult = {
  id: string;
  category: string;
  pass: boolean;
  mismatches: readonly string[];
  latencyMs: number | null;
  tokens: { input: number; output: number } | null;
  errorName?: string | null;
};

export type CategorySummary = {
  total: number;
  passed: number;
  passRate: number;
};

export type EvalSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<string, CategorySummary>;
  latencyMs: { p50: number | null; p95: number | null };
  tokens: { input: number; output: number };
  failures: { id: string; category: string; mismatches: string[]; errorName: string | null }[];
  overallGate: boolean;
  criticalGate: boolean;
};

const compareCaseInsensitive = (left: string, right: string): number => {
  const folded = left.toLowerCase().localeCompare(right.toLowerCase());

  return folded === 0 ? left.localeCompare(right) : folded;
};

// Mirrors the neutral-default stripping the Llama-era route applied (removed in Phase 5); kept so older fixtures score the same: neutral
// defaults the application ignores never count as a difference.
const normalizePatch = (patch: ModelDraftPatch): ModelDraftPatch => {
  const normalized: ModelDraftPatch = {};

  if (patch.source !== undefined) {
    normalized.source = patch.source;
  }

  if (patch.topics !== undefined && patch.topics.length > 0) {
    normalized.topics = [...patch.topics].sort();
  }

  if (patch.username !== undefined && patch.username !== null) {
    normalized.username = patch.username;
  }

  if (patch.repoSelection !== undefined && patch.repoSelection !== null) {
    normalized.repoSelection =
      patch.repoSelection.kind === "subset"
        ? { kind: "subset", repos: [...patch.repoSelection.repos].sort(compareCaseInsensitive) }
        : { ...patch.repoSelection };
  }

  if (patch.activityType !== undefined) {
    normalized.activityType = patch.activityType;
  }

  if (patch.ttl !== undefined) {
    normalized.ttl = patch.ttl;
  }

  return normalized;
};

export const normalizeDecision = (decision: ModelDecision): ModelDecision => ({
  intent: decision.intent,
  draftPatch: normalizePatch(decision.draftPatch),
  ...(decision.repoSelectionAction === undefined
    ? {}
    : { repoSelectionAction: { ...decision.repoSelectionAction } }),
  ...(decision.unsupportedReason === undefined
    ? {}
    : { unsupportedReason: decision.unsupportedReason }),
});

const stable = (value: unknown): string | undefined => JSON.stringify(canonicalizeJson(value));

export const scoreFixture = (expected: ModelDecision, actual: ModelDecision): FixtureScore => {
  const normalizedExpected = normalizeDecision(expected);
  const normalizedActual = normalizeDecision(actual);
  const mismatches = DECISION_PARTS.filter(
    (part) => stable(normalizedExpected[part]) !== stable(normalizedActual[part]),
  );

  return { pass: mismatches.length === 0, mismatches };
};

// Nearest-rank percentile; `fraction` is in (0, 1].
export const percentile = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length)));

  return sorted[rank - 1] ?? null;
};

const rate = (passed: number, total: number): number => (total === 0 ? 0 : passed / total);

export const summarize = (results: readonly FixtureResult[]): EvalSummary => {
  const byCategory: Record<string, CategorySummary> = {};

  for (const result of results) {
    const entry = byCategory[result.category] ?? { total: 0, passed: 0, passRate: 0 };

    entry.total += 1;
    entry.passed += result.pass ? 1 : 0;
    entry.passRate = rate(entry.passed, entry.total);
    byCategory[result.category] = entry;
  }

  const passed = results.filter((result) => result.pass).length;
  const latencies = results.flatMap((result) =>
    result.latencyMs === null ? [] : [result.latencyMs],
  );
  const passRate = rate(passed, results.length);

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate,
    byCategory,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    tokens: {
      input: results.reduce((sum, result) => sum + (result.tokens?.input ?? 0), 0),
      output: results.reduce((sum, result) => sum + (result.tokens?.output ?? 0), 0),
    },
    failures: results
      .filter((result) => !result.pass)
      .map((result) => ({
        id: result.id,
        category: result.category,
        mismatches: [...result.mismatches],
        errorName: result.errorName ?? null,
      })),
    overallGate: passRate >= OVERALL_PASS_RATE_GATE,
    criticalGate: results
      .filter((result) => CRITICAL_CATEGORIES.includes(result.category))
      .every((result) => result.pass),
  };
};

// Object keys are sorted; array order is kept, because the order of examples
// is part of the wording the model sees.
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    );
  }

  return value;
};

export const questionSetHash = (questions: Readonly<Record<string, JevQuestion>>): string =>
  createHash("sha256")
    .update(JSON.stringify(sortKeys(questions)))
    .digest("hex");

// The static question set: what `buildJevQuestions` asks before any
// per-turn candidate or draft-topic question is added.
export const staticQuestionSetHash = (): string =>
  questionSetHash(
    buildJevQuestions(DEFAULT_FEED_DRAFT, {
      topics: [],
      usernames: [],
      repositories: [],
      firstCount: null,
      frequency: null,
    }),
  );
