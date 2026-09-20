import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isModelDecision, type ModelDecision } from "../../worker/src/assistant/contracts";
import {
  candidatesFor,
  type TurnCandidates,
} from "../../worker/src/assistant/interpreter/jev/candidates";
import {
  ACTION_THRESHOLD,
  CHOICE_CONFIDENCE_THRESHOLD,
  composeDecision,
  JevCompositionError,
  STATED_THRESHOLD,
} from "../../worker/src/assistant/interpreter/jev/compose";
import { buildJevQuestions } from "../../worker/src/assistant/interpreter/jev/questions";
import { buildJevState, JEV_STATE_VERSION } from "../../worker/src/assistant/interpreter/jev/state";
import type { JevAnswer } from "../../worker/src/assistant/interpreter/jev/types";
import {
  ADAPTIVE_MODEL_EVAL_V1,
  type AssistantModelEvalFixture,
} from "../fixtures/assistant-model-eval-v1";
import {
  JEV_MODEL_ID,
  runJev,
  TYPESAFE_MODEL_ID,
  type CloudflareAiCredentials,
} from "./cloudflare-ai";
import {
  OVERALL_PASS_RATE_GATE,
  scoreFixture,
  staticQuestionSetHash,
  summarize,
  type FixtureResult,
} from "./score";

const FIXTURE_VERSION = "adaptive-eval-v1";
const HARD_REQUEST_CAP = 80;
const CHALLENGER_IDS = ["asks_for_information", "about_ui_visibility", "out_of_scope"] as const;

type ChallengerId = (typeof CHALLENGER_IDS)[number];

type RecordedAnswers = {
  intent: { choice: string; confidence: number } | null;
  challengers: Record<ChallengerId, number | null>;
  // Every judgment by question id, plus the candidate values the indexed
  // topic questions refer to, so a failure can be traced to one question.
  all: Record<string, number | { choice: string; confidence: number }>;
  topicCandidates: string[];
  usernameCandidates: string[];
};

type EvalRow = FixtureResult & {
  expected: ModelDecision;
  actual: ModelDecision | null;
  confidence: number | null;
  echoedModel: string | null;
  answers: RecordedAnswers | null;
  errorName: string | null;
  errorMessage: string | null;
};

// The direct TypeSafe API is preferred when its key is present: it pins an
// exact model version. Otherwise the Cloudflare-hosted model is used.
const resolveCredentials = (): CloudflareAiCredentials | null => {
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_AI_API_TOKEN;

  if (typesafeKey && process.env.EVAL_TRANSPORT !== "cloudflare") {
    return { transport: "typesafe", apiToken: typesafeKey };
  }

  if (accountId && apiToken) {
    return { transport: "cloudflare", accountId, apiToken };
  }

  return null;
};

const credentials = resolveCredentials();

const selectFixtures = (raw: string | undefined): readonly AssistantModelEvalFixture[] => {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (ids.length === 0) {
    return ADAPTIVE_MODEL_EVAL_V1;
  }

  const unknown = ids.filter((id) => !ADAPTIVE_MODEL_EVAL_V1.some((entry) => entry.id === id));

  if (unknown.length > 0) {
    throw new Error(`EVAL_FIXTURE_IDS names unknown fixtures: ${unknown.join(", ")}`);
  }

  return ADAPTIVE_MODEL_EVAL_V1.filter((entry) => ids.includes(entry.id));
};

const requestCap = (raw: string | undefined, fixtureCount: number): number => {
  if (raw === undefined || raw.trim().length === 0) {
    return Math.min(fixtureCount, HARD_REQUEST_CAP);
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("EVAL_MAX_REQUESTS must be a positive integer");
  }

  return Math.min(parsed, HARD_REQUEST_CAP);
};

const recordAnswers = (
  answers: Readonly<Record<string, JevAnswer>>,
  candidates: TurnCandidates,
): RecordedAnswers => {
  const intent = answers.intent;
  const noulOf = (id: ChallengerId): number | null => {
    const answer = answers[id];

    return answer?.type === "noul" ? answer.noul : null;
  };

  return {
    intent:
      intent?.type === "choice" ? { choice: intent.choice, confidence: intent.confidence } : null,
    challengers: {
      asks_for_information: noulOf("asks_for_information"),
      about_ui_visibility: noulOf("about_ui_visibility"),
      out_of_scope: noulOf("out_of_scope"),
    },
    all: Object.fromEntries(
      Object.entries(answers).map(([id, answer]) => [
        id,
        answer.type === "noul"
          ? answer.noul
          : { choice: answer.choice, confidence: answer.confidence },
      ]),
    ),
    topicCandidates: candidates.topics.map((candidate) => candidate.slug),
    usernameCandidates: [...candidates.usernames],
  };
};

const errorNameOf = (error: unknown): string => {
  // JevCompositionError does not override `name`.
  if (error instanceof JevCompositionError) {
    return "JevCompositionError";
  }

  return error instanceof Error ? error.name : "UnknownError";
};

const failedRow = (
  entry: AssistantModelEvalFixture,
  partial: Partial<EvalRow>,
  error: unknown,
): EvalRow => ({
  id: entry.id,
  category: entry.category,
  pass: false,
  mismatches: [],
  expected: entry.expected,
  actual: null,
  confidence: null,
  latencyMs: null,
  tokens: null,
  echoedModel: null,
  answers: null,
  ...partial,
  errorName: errorNameOf(error),
  errorMessage: error instanceof Error ? error.message : null,
});

const evaluateFixture = async (
  entry: AssistantModelEvalFixture,
  credentials: CloudflareAiCredentials,
  budget: { sent: number },
): Promise<EvalRow> => {
  const turn = entry.currentTurn;
  const observed: Partial<EvalRow> = {};

  try {
    if (budget.sent >= HARD_REQUEST_CAP) {
      const exhausted = new Error(`hard cap of ${HARD_REQUEST_CAP} HTTP requests reached`);

      exhausted.name = "RequestBudgetExhausted";
      throw exhausted;
    }

    const candidates = candidatesFor(turn.message, turn.draft.topics);
    const state = buildJevState(turn, candidates);
    const questions = buildJevQuestions(turn.draft, candidates);
    const { response, latencyMs } = await runJev(
      credentials,
      { state, questions },
      {
        // A retry is a second HTTP request; never let it cross the hard cap.
        allowRetry: budget.sent + 2 <= HARD_REQUEST_CAP,
        onRequest: () => {
          budget.sent += 1;
        },
      },
    );

    observed.latencyMs = latencyMs;
    observed.echoedModel = response.model;
    observed.answers = recordAnswers(response.answers, candidates);
    observed.tokens =
      response.usage === undefined
        ? null
        : { input: response.usage.input_tokens, output: response.usage.output_tokens };

    const composed = composeDecision(turn, candidates, response.answers);

    observed.confidence = composed.confidence;

    if (!isModelDecision(composed.decision)) {
      const invalid = new Error("composed decision is not a valid ModelDecision");

      invalid.name = "InvalidModelDecision";
      throw invalid;
    }

    const score = scoreFixture(entry.expected, composed.decision);

    return {
      id: entry.id,
      category: entry.category,
      pass: score.pass,
      mismatches: score.mismatches,
      expected: entry.expected,
      actual: composed.decision,
      confidence: composed.confidence,
      latencyMs,
      tokens: observed.tokens,
      echoedModel: response.model,
      answers: observed.answers,
      errorName: null,
      errorMessage: null,
    };
  } catch (error) {
    return failedRow(entry, observed, error);
  }
};

const writeReport = async (report: unknown, startedAt: Date): Promise<URL> => {
  const directory = new URL("./results/", import.meta.url);
  const file = new URL(`jev-${startedAt.toISOString().replaceAll(":", "-")}.json`, directory);

  await mkdir(directory, { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return file;
};

describe.skipIf(credentials === null)("Jev interpreter evaluation (offline, billed)", () => {
  it("meets the Phase 0 gates on adaptive-eval-v1", async () => {
    if (credentials === null) {
      throw new Error(
        "TYPESAFE_API_KEY, or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN, are required",
      );
    }

    const fixtures = selectFixtures(process.env.EVAL_FIXTURE_IDS);
    const cap = requestCap(process.env.EVAL_MAX_REQUESTS, fixtures.length);

    // One request per fixture; refuse before anything is sent.
    if (fixtures.length > cap) {
      throw new Error(
        `Planned ${fixtures.length} requests exceeds the cap of ${cap} (hard cap ${HARD_REQUEST_CAP})`,
      );
    }

    const startedAt = new Date();
    const budget = { sent: 0 };
    const rows: EvalRow[] = [];

    // Sequential on purpose: one in-flight request keeps within rate limits.
    for (const entry of fixtures) {
      const row = await evaluateFixture(entry, credentials, budget);

      // Credential and billing failures affect every request alike; stop
      // rather than spend the remaining budget on identical errors.
      if (
        row.errorName === "CloudflareAiError" &&
        /\(status (?:401|402|403)\)/u.test(row.errorMessage ?? "")
      ) {
        throw new Error(`Aborted after ${budget.sent} request(s): ${row.errorMessage}`);
      }

      rows.push(row);
    }

    const summary = summarize(rows);
    const report = {
      run: {
        startedAt: startedAt.toISOString(),
        transport: credentials.transport,
        modelRequested: credentials.transport === "typesafe" ? TYPESAFE_MODEL_ID : JEV_MODEL_ID,
        modelVersionsEchoed: [...new Set(rows.flatMap((row) => row.echoedModel ?? []))].sort(),
        jevStateVersion: JEV_STATE_VERSION,
        questionSetHash: staticQuestionSetHash(),
        thresholds: {
          stated: STATED_THRESHOLD,
          action: ACTION_THRESHOLD,
          choiceConfidence: CHOICE_CONFIDENCE_THRESHOLD,
          overallPassRate: OVERALL_PASS_RATE_GATE,
        },
        fixtureVersion: FIXTURE_VERSION,
        fixtureCount: fixtures.length,
        subset: fixtures.length !== ADAPTIVE_MODEL_EVAL_V1.length,
        httpRequestsSent: budget.sent,
      },
      summary,
      fixtures: rows,
    };
    const file = await writeReport(report, startedAt);

    // oxlint-disable-next-line no-console -- The console report is this evaluation's intended output.
    console.table(
      rows.map((row) => ({
        id: row.id,
        category: row.category,
        pass: row.pass,
        mismatches: row.errorName ?? row.mismatches.join(","),
        confidence: row.confidence === null ? null : Number(row.confidence.toFixed(3)),
        latencyMs: row.latencyMs === null ? null : Math.round(row.latencyMs),
      })),
    );
    // oxlint-disable-next-line no-console -- The console report is this evaluation's intended output.
    console.log(JSON.stringify(summary, null, 2));
    // oxlint-disable-next-line no-console -- The console report is this evaluation's intended output.
    console.log(`Report: ${file.pathname}`);

    expect(summary.criticalGate).toBe(true);
    expect(summary.overallGate).toBe(true);
  });
});
