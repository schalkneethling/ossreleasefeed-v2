export type AssistantRequiredDecision =
  | "feed-source"
  | "topic-selection"
  | "github-username"
  | "repository-selection"
  | "feed-settings"
  | "recovery"
  | "complete-feed";

type Described = string | Record<string, unknown> | readonly unknown[];

export type NoulQuestion = {
  type: "noul";
  instructions: Described;
  criteria: { true: Described; false: Described };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: Described;
  // `null` leaves a label undescribed, as when the labels are candidate values.
  criteria: Record<string, Described | null>;
};

export type JevQuestion = NoulQuestion | ChoiceQuestion;

export type NoulAnswer = { type: "noul"; noul: number };

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type JevAnswer = NoulAnswer | ChoiceAnswer;

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProbability = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 1;

const isJevAnswer = (value: unknown): value is JevAnswer => {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "noul") {
    return isProbability(value.noul);
  }

  return (
    value.type === "choice" &&
    typeof value.choice === "string" &&
    isProbability(value.confidence) &&
    isRecord(value.probabilities)
  );
};

const isUsage = (value: unknown): value is NonNullable<JevResponse["usage"]> =>
  isRecord(value) &&
  typeof value.input_tokens === "number" &&
  typeof value.output_tokens === "number";

export const isJevResponse = (value: unknown): value is JevResponse =>
  isRecord(value) &&
  typeof value.model === "string" &&
  isRecord(value.answers) &&
  Object.values(value.answers).every(isJevAnswer) &&
  (value.usage === undefined || isUsage(value.usage));
