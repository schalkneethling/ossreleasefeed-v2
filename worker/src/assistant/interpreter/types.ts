import type { AssistantTurnRequest, ModelDecision } from "../contracts";
import type { WorkerBindings } from "../../lib/types";
import type { AssistantRequiredDecision } from "../../../../shared/adaptive-contracts";

// The validated turn payload plus the application-derived required decision.
export type InterpreterTurn = AssistantTurnRequest & {
  requiredDecision: AssistantRequiredDecision;
};

export type Interpretation = {
  decision: ModelDecision;
  // Catalogue suggestions for signals the interpreter saw but did not apply.
  hints: string[];
  // The least certain judgment consumed; `null` when the interpreter has none.
  confidence: number | null;
  // How sure the interpreter is of the intent alone.
  intentConfidence: number | null;
};

export type Interpreter = (
  turn: InterpreterTurn,
  env: WorkerBindings,
  signal: AbortSignal,
) => Promise<Interpretation>;

export class AssistantModelError extends Error {}
