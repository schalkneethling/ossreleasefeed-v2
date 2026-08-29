import {
  ADAPTIVE_STATES,
  FEED_TTLS,
  type AdaptiveState,
  type FeedDraft,
  type FeedTtl,
} from "../../../shared/adaptive-contracts";

export {
  ADAPTIVE_STATES,
  DEFAULT_FEED_DRAFT,
  FEED_TTLS,
  type AdaptiveState,
  type FeedDraft,
  type FeedTtl,
} from "../../../shared/adaptive-contracts";

export const ASSISTANT_INTENTS = [
  "create-or-update-feed",
  "explain-capabilities",
  "list-topics",
  "list-repositories",
  "list-settings",
  "show-ui",
  "hide-ui",
  "unsupported",
] as const;

const FEED_SOURCES = ["topics", "starred"] as const;
const ACTIVITY_TYPES = ["releases", "all"] as const;
const FEED_DRAFT_KEYS = [
  "source",
  "topics",
  "username",
  "repoSelection",
  "activityType",
  "ttl",
  "format",
  "topicOperator",
] as const;
const ASSISTANT_REQUEST_KEYS = ["message", "state", "draft", "issues", "ttlSelected"] as const;
const MODEL_DECISION_KEYS = [
  "intent",
  "draftPatch",
  "repoSelectionAction",
  "unsupportedReason",
] as const;
const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,34}$/u;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

export type AssistantTurnRequest = {
  message: string;
  state: AdaptiveState;
  draft: FeedDraft;
  issues: string[];
  ttlSelected: boolean;
};

export type AssistantTurnResponse = {
  state: AdaptiveState;
  draft: FeedDraft;
  message: string;
  issues: string[];
  feedUrl: string | null;
  showUi: boolean;
  ttlSelected: boolean;
};

export type ModelDraftPatch = Omit<Partial<FeedDraft>, "source"> & {
  source?: Exclude<FeedDraft["source"], null>;
};

export type ModelRepoSelectionAction =
  | { kind: "all" }
  | {
      kind: "first";
      count: number;
    };

export type ModelDecision = {
  intent: AssistantIntent;
  draftPatch: ModelDraftPatch;
  repoSelectionAction?: ModelRepoSelectionAction;
  unsupportedReason?: "interval" | "request";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasAllowedKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = [],
): boolean => {
  const keys = Object.keys(value);

  return keys.every((key) => allowed.includes(key)) && required.every((key) => key in value);
};

const isOneOf = <T extends string | number>(
  value: unknown,
  allowedValues: readonly T[],
): value is T => allowedValues.some((allowedValue) => allowedValue === value);

const isStringArray = (value: unknown, maximumLength: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= maximumLength &&
  value.every((item) => typeof item === "string");

export const isAdaptiveState = (value: unknown): value is AdaptiveState =>
  isOneOf(value, ADAPTIVE_STATES);

const isTtl = (value: unknown): value is FeedTtl => isOneOf(value, FEED_TTLS);

const isRepoSelection = (value: unknown): value is FeedDraft["repoSelection"] => {
  if (value === null) {
    return true;
  }

  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "all") {
    return hasAllowedKeys(value, ["kind"], ["kind"]);
  }

  return (
    value.kind === "subset" &&
    hasAllowedKeys(value, ["kind", "repos"], ["kind", "repos"]) &&
    isStringArray(value.repos, 25) &&
    value.repos.length > 0 &&
    new Set(value.repos).size === value.repos.length
  );
};

export const isFeedDraft = (value: unknown): value is FeedDraft => {
  if (!isRecord(value) || !hasAllowedKeys(value, FEED_DRAFT_KEYS, FEED_DRAFT_KEYS)) {
    return false;
  }

  if (value.source !== null && !isOneOf(value.source, FEED_SOURCES)) {
    return false;
  }

  if (
    !isStringArray(value.topics, 5) ||
    !value.topics.every((topic) => TOPIC_SLUG.test(topic)) ||
    new Set(value.topics).size !== value.topics.length
  ) {
    return false;
  }

  if (value.username !== null && typeof value.username !== "string") {
    return false;
  }

  return (
    isRepoSelection(value.repoSelection) &&
    isOneOf(value.activityType, ACTIVITY_TYPES) &&
    isTtl(value.ttl) &&
    value.format === "atom" &&
    value.topicOperator === "or"
  );
};

export const isAssistantTurnRequest = (value: unknown): value is AssistantTurnRequest => {
  if (!isRecord(value) || !hasAllowedKeys(value, ASSISTANT_REQUEST_KEYS, ASSISTANT_REQUEST_KEYS)) {
    return false;
  }

  return (
    typeof value.message === "string" &&
    value.message.length >= 1 &&
    value.message.length <= 1_000 &&
    isAdaptiveState(value.state) &&
    isFeedDraft(value.draft) &&
    isStringArray(value.issues, 5) &&
    typeof value.ttlSelected === "boolean"
  );
};

const isModelDraftPatch = (value: unknown): value is ModelDraftPatch => {
  if (!isRecord(value) || !hasAllowedKeys(value, FEED_DRAFT_KEYS)) {
    return false;
  }

  if ("source" in value && !isOneOf(value.source, FEED_SOURCES)) {
    return false;
  }

  if ("topics" in value && !isStringArray(value.topics, 5)) {
    return false;
  }

  if ("username" in value && value.username !== null && typeof value.username !== "string") {
    return false;
  }

  if ("repoSelection" in value && !isRepoSelection(value.repoSelection)) {
    return false;
  }

  if ("activityType" in value && !isOneOf(value.activityType, ACTIVITY_TYPES)) {
    return false;
  }

  if ("ttl" in value && !isTtl(value.ttl)) {
    return false;
  }

  if ("format" in value && value.format !== "atom") {
    return false;
  }

  if ("topicOperator" in value && value.topicOperator !== "or") {
    return false;
  }

  const hasTopics = Array.isArray(value.topics) && value.topics.length > 0;
  const hasStarredFields =
    ("username" in value && value.username !== null) ||
    ("repoSelection" in value && value.repoSelection !== null);

  if (hasTopics && hasStarredFields) {
    return false;
  }

  if (value.source === "topics" && hasStarredFields) {
    return false;
  }

  return value.source !== "starred" || !hasTopics;
};

const isModelRepoSelectionAction = (value: unknown): value is ModelRepoSelectionAction => {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === "all") {
    return hasAllowedKeys(value, ["kind"], ["kind"]);
  }

  return (
    hasAllowedKeys(value, ["kind", "count"], ["kind", "count"]) &&
    value.kind === "first" &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count >= 1 &&
    value.count <= 25
  );
};

export const isModelDecision = (value: unknown): value is ModelDecision => {
  if (!isRecord(value) || !hasAllowedKeys(value, MODEL_DECISION_KEYS, ["intent", "draftPatch"])) {
    return false;
  }

  if (
    !isOneOf(value.intent, ASSISTANT_INTENTS) ||
    !isModelDraftPatch(value.draftPatch) ||
    ("repoSelectionAction" in value && !isModelRepoSelectionAction(value.repoSelectionAction))
  ) {
    return false;
  }

  if (value.intent === "unsupported") {
    return value.unsupportedReason === "interval" || value.unsupportedReason === "request";
  }

  return !("unsupportedReason" in value);
};
