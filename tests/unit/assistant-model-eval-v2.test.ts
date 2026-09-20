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

type CurrentTurn = AssistantModelEvalFixture["currentTurn"];

// Fixtures whose requiredDecision cannot be re-derived from the natural
// editable state of their draft. Each entry supplies the state the application
// would actually be in.
const STATE_OVERRIDES: Readonly<Record<string, AdaptiveState>> = {
  // A rejected username stays in the draft while the application remains in
  // enter-username; the natural editable state would be choose-repos.
  "h-username-typo-correction": "enter-username",
};

const naturalStateFor = ({ draft, issues, ttlSelected }: CurrentTurn): AdaptiveState => {
  const editableState = editableStateForDraft(draft);

  if (editableState === "edit-settings" && ttlSelected && issues.length === 0) {
    return "ready";
  }

  return editableState;
};

// Mirrors requiredDecisionFor in worker/src/routes/assistant.ts.
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

describe("adaptive model evaluation fixture v2 (held-out)", () => {
  it("contains 40-45 uniquely identified, h-prefixed, schema-valid expected decisions", () => {
    expect(ADAPTIVE_MODEL_EVAL_V2_HELDOUT.length).toBeGreaterThanOrEqual(40);
    expect(ADAPTIVE_MODEL_EVAL_V2_HELDOUT.length).toBeLessThanOrEqual(45);
    expect(new Set(ADAPTIVE_MODEL_EVAL_V2_HELDOUT.map((entry) => entry.id)).size).toBe(
      ADAPTIVE_MODEL_EVAL_V2_HELDOUT.length,
    );
    expect(
      ADAPTIVE_MODEL_EVAL_V2_HELDOUT.filter((entry) => !entry.id.startsWith("h-")).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);

    expect(
      ADAPTIVE_MODEL_EVAL_V2_HELDOUT.filter(
        (entry) => entry.currentTurn.message.trim().length === 0,
      ).map((entry) => entry.id),
    ).toEqual([]);
    expect(
      ADAPTIVE_MODEL_EVAL_V2_HELDOUT.filter((entry) => !isModelDecision(entry.expected)).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);
  });

  it("keeps all informational and safety expectations mutation-free", () => {
    const readOnlyEntries = ADAPTIVE_MODEL_EVAL_V2_HELDOUT.filter(
      (entry) => entry.category === "informational" || entry.category === "safety",
    );

    expect(readOnlyEntries.map((entry) => entry.expected.draftPatch)).toEqual(
      readOnlyEntries.map(() => ({})),
    );
    expect(readOnlyEntries.flatMap((entry) => entry.expected.repoSelectionAction ?? [])).toEqual(
      [],
    );
  });

  it("does not reuse any v1 message", () => {
    const v1Messages = new Set(
      ADAPTIVE_MODEL_EVAL_V1.map((entry) => normalizeMessage(entry.currentTurn.message)),
    );

    expect(
      ADAPTIVE_MODEL_EVAL_V2_HELDOUT.filter((entry) =>
        v1Messages.has(normalizeMessage(entry.currentTurn.message)),
      ).map((entry) => entry.id),
    ).toEqual([]);
  });

  it("labels every requiredDecision consistently with its draft, issues, and ttlSelected", () => {
    const fixtureIds = new Set(ADAPTIVE_MODEL_EVAL_V2_HELDOUT.map((entry) => entry.id));

    expect(Object.keys(STATE_OVERRIDES).filter((id) => !fixtureIds.has(id))).toEqual([]);

    const inconsistent = ADAPTIVE_MODEL_EVAL_V2_HELDOUT.flatMap((entry) => {
      const state = STATE_OVERRIDES[entry.id] ?? naturalStateFor(entry.currentTurn);
      const derived = deriveRequiredDecision(state, entry.currentTurn);

      return derived === entry.currentTurn.requiredDecision
        ? []
        : [{ id: entry.id, labelled: entry.currentTurn.requiredDecision, derived }];
    });

    expect(inconsistent).toEqual([]);
  });
});
