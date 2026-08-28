import { describe, expect, it } from "vitest";
import { isModelDecision } from "../../worker/src/assistant/contracts";
import { ADAPTIVE_MODEL_EVAL_V1 } from "../fixtures/assistant-model-eval-v1";

describe("adaptive model evaluation fixture v1", () => {
  it("contains at least 30 uniquely identified, schema-valid expected decisions", () => {
    expect(ADAPTIVE_MODEL_EVAL_V1.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ADAPTIVE_MODEL_EVAL_V1.map((entry) => entry.id)).size).toBe(
      ADAPTIVE_MODEL_EVAL_V1.length,
    );

    expect(
      ADAPTIVE_MODEL_EVAL_V1.filter((entry) => entry.currentTurn.message.length === 0).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);
    expect(
      ADAPTIVE_MODEL_EVAL_V1.filter((entry) => !isModelDecision(entry.expected)).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);
  });

  it("keeps all informational and safety expectations mutation-free", () => {
    const readOnlyEntries = ADAPTIVE_MODEL_EVAL_V1.filter(
      (entry) => entry.category === "informational" || entry.category === "safety",
    );

    expect(readOnlyEntries.map((entry) => entry.expected.draftPatch)).toEqual(
      readOnlyEntries.map(() => ({})),
    );
    expect(readOnlyEntries.flatMap((entry) => entry.expected.repoSelectionAction ?? [])).toEqual(
      [],
    );
  });
});
