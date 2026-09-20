import { AssistantModelError, type Interpreter } from "../types";
import { candidatesFor } from "./candidates";
import { EXPECTED_JEV_MODEL, runJev } from "./client";
import { composeDecision, JevCompositionError } from "./compose";
import { buildJevQuestions } from "./questions";
import { buildJevState } from "./state";

export class JevConfigurationError extends Error {
  override name = "JevConfigurationError";
}

// Jev judges; code does the rest. Candidates are found in code, the state
// carries only the current message, the validated draft summary, and the
// application-derived last question, and the answers are composed in code.
export const interpretWithJev: Interpreter = async (turn, env, signal) => {
  const apiKey = env.TYPESAFE_API_KEY;

  if (!apiKey) {
    throw new JevConfigurationError("typesafe-api-key-missing");
  }

  const candidates = candidatesFor(turn.message, turn.draft.topics);
  const response = await runJev(
    apiKey,
    {
      state: buildJevState(turn, candidates),
      questions: buildJevQuestions(turn.draft, candidates),
    },
    signal,
  );

  if (response.model !== EXPECTED_JEV_MODEL) {
    // oxlint-disable-next-line no-console -- Structured Worker diagnostics are the intended output.
    console.warn({
      event: "assistant_model_version_mismatch",
      expected: EXPECTED_JEV_MODEL,
      received: response.model.slice(0, 64),
    });
  }

  try {
    return composeDecision(turn, candidates, response.answers);
  } catch (error) {
    if (error instanceof JevCompositionError) {
      throw new AssistantModelError(error.message, { cause: error });
    }

    throw error;
  }
};
