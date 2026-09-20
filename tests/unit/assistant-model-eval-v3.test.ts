import { describe, expect, it } from "vitest";
import {
  editableStateForDraft,
  isRepoSelectionComplete,
  type AdaptiveState,
} from "../../shared/adaptive-contracts";
import { isModelDecision } from "../../worker/src/assistant/contracts";
import {
  ADAPTIVE_MODEL_EVAL_V1,
  type AssistantModelEvalFixture,
  type AssistantRequiredDecision,
} from "../fixtures/assistant-model-eval-v1";
import { ADAPTIVE_MODEL_EVAL_V2_HELDOUT } from "../fixtures/assistant-model-eval-v2-heldout";
import { ADAPTIVE_MODEL_EVAL_V3_VALIDATION } from "../fixtures/assistant-model-eval-v3-validation";

type CurrentTurn = AssistantModelEvalFixture["currentTurn"];

// Fixtures whose requiredDecision cannot be re-derived from the natural
// editable state of their draft. Each entry supplies the state the application
// would actually be in.
const STATE_OVERRIDES: Readonly<Record<string, AdaptiveState>> = {};

const naturalStateFor = ({ draft, issues, ttlSelected }: CurrentTurn): AdaptiveState => {
  const editableState = editableStateForDraft(draft);

  if (editableState === "edit-settings" && ttlSelected && issues.length === 0) {
    return "ready";
  }

  return editableState;
};

// Mirrors requiredDecisionFor in worker/src/assistant/planner.ts.
const deriveRequiredDecision = (
  state: AdaptiveState,
  { draft, issues, ttlSelected }: CurrentTurn,
): AssistantRequiredDecision => {
  if (draft.source === null) {
    return "feed-source";
  }

  if (draft.source === "topics") {
    if (draft.topics.length === 0 || (state === "edit-topics" && issues.length > 0)) {
      return "topic-selection";
    }
  }

  if (draft.source === "starred") {
    if (draft.username === null || (state === "enter-username" && issues.length > 0)) {
      return "github-username";
    }

    if (!isRepoSelectionComplete(draft.repoSelection)) {
      return "repository-selection";
    }
  }

  if (state === "recoverable-error" || issues.length > 0) {
    return "recovery";
  }

  if (!ttlSelected || state === "edit-settings") {
    return "feed-settings";
  }

  return "complete-feed";
};

const normalizeMessage = (message: string): string => message.trim().toLowerCase();

describe("adaptive model evaluation fixture v3 (fresh validation)", () => {
  it("contains exactly 18 uniquely identified, v-prefixed, schema-valid expected decisions", () => {
    expect(ADAPTIVE_MODEL_EVAL_V3_VALIDATION.length).toBe(18);
    expect(new Set(ADAPTIVE_MODEL_EVAL_V3_VALIDATION.map((entry) => entry.id)).size).toBe(
      ADAPTIVE_MODEL_EVAL_V3_VALIDATION.length,
    );
    expect(
      ADAPTIVE_MODEL_EVAL_V3_VALIDATION.filter((entry) => !entry.id.startsWith("v-")).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);

    expect(
      ADAPTIVE_MODEL_EVAL_V3_VALIDATION.filter(
        (entry) => entry.currentTurn.message.trim().length === 0,
      ).map((entry) => entry.id),
    ).toEqual([]);
    expect(
      ADAPTIVE_MODEL_EVAL_V3_VALIDATION.filter((entry) => !isModelDecision(entry.expected)).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);
  });

  it("keeps every safety expectation an empty-patch, no-action discard of the whole message", () => {
    const safetyEntries = ADAPTIVE_MODEL_EVAL_V3_VALIDATION.filter(
      (entry) => entry.category === "safety",
    );

    expect(safetyEntries.map((entry) => entry.expected.draftPatch)).toEqual(
      safetyEntries.map(() => ({})),
    );
    expect(safetyEntries.flatMap((entry) => entry.expected.repoSelectionAction ?? [])).toEqual([]);
    expect(safetyEntries.map((entry) => entry.expected.intent)).toEqual(
      safetyEntries.map(() => "unsupported"),
    );
    expect(safetyEntries.map((entry) => entry.expected.unsupportedReason)).toEqual(
      safetyEntries.map(() => "request"),
    );
  });

  it("does not reuse any v1 or v2 message", () => {
    const priorMessages = new Set(
      [...ADAPTIVE_MODEL_EVAL_V1, ...ADAPTIVE_MODEL_EVAL_V2_HELDOUT].map((entry) =>
        normalizeMessage(entry.currentTurn.message),
      ),
    );

    expect(
      ADAPTIVE_MODEL_EVAL_V3_VALIDATION.filter((entry) =>
        priorMessages.has(normalizeMessage(entry.currentTurn.message)),
      ).map((entry) => entry.id),
    ).toEqual([]);
  });

  it("labels every requiredDecision consistently with its draft, issues, and ttlSelected", () => {
    const fixtureIds = new Set(ADAPTIVE_MODEL_EVAL_V3_VALIDATION.map((entry) => entry.id));

    expect(Object.keys(STATE_OVERRIDES).filter((id) => !fixtureIds.has(id))).toEqual([]);

    const inconsistent = ADAPTIVE_MODEL_EVAL_V3_VALIDATION.flatMap((entry) => {
      const state = STATE_OVERRIDES[entry.id] ?? naturalStateFor(entry.currentTurn);
      const derived = deriveRequiredDecision(state, entry.currentTurn);

      return derived === entry.currentTurn.requiredDecision
        ? []
        : [{ id: entry.id, labelled: entry.currentTurn.requiredDecision, derived }];
    });

    expect(inconsistent).toEqual([]);
  });
});
