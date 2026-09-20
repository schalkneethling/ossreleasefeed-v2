import type { AssistantTurnRequest, ModelDecision } from "../contracts";
import type { WorkerBindings } from "../../lib/types";
import type { AssistantRequiredDecision } from "../../../../shared/adaptive-contracts";

// The validated turn payload plus the application-derived required decision.
export type InterpreterTurn = AssistantTurnRequest & {
  requiredDecision: AssistantRequiredDecision;
};

export type Interpreter = (
  turn: InterpreterTurn,
  env: WorkerBindings,
  signal: AbortSignal,
) => Promise<ModelDecision>;

export class AssistantModelError extends Error {}
