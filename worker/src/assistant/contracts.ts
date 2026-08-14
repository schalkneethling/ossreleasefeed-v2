export const ADAPTIVE_STATES = [
  "idle",
  "choose-source",
  "edit-topics",
  "enter-username",
  "choose-repos",
  "edit-settings",
  "ready",
  "recoverable-error",
] as const;
export const ALLOWED_TTLS = [3600, 21600, 86400, 604800] as const;
export const ASSISTANT_INTENTS = [
  "create-or-update-feed",
  "explain-capabilities",
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
const ASSISTANT_REQUEST_KEYS = ["message", "history", "state", "draft"] as const;
const HISTORY_TURN_KEYS = ["role", "content"] as const;
const MODEL_DECISION_KEYS = ["intent", "proposedState", "draftPatch", "framing"] as const;
const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,34}$/u;

export type AdaptiveState = (typeof ADAPTIVE_STATES)[number];
export type FeedTtl = (typeof ALLOWED_TTLS)[number];
export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];
export type AssistantRole = "user" | "assistant";

export type FeedDraft = {
  source: "topics" | "starred" | null;
  topics: string[];
  username: string | null;
  repoSelection: { kind: "all" } | { kind: "subset"; repos: string[] } | null;
  activityType: "releases" | "all";
  ttl: FeedTtl;
  format: "atom";
  topicOperator: "or";
};

export const DEFAULT_FEED_DRAFT: FeedDraft = {
  source: null,
  topics: [],
  username: null,
  repoSelection: null,
  activityType: "releases",
  ttl: 3600,
  format: "atom",
  topicOperator: "or",
};

export type AssistantHistoryTurn = {
  role: AssistantRole;
  content: string;
};

export type AssistantTurnRequest = {
  message: string;
  history: AssistantHistoryTurn[];
  state: AdaptiveState;
  draft: FeedDraft;
};

export type AssistantTurnResponse = {
  state: AdaptiveState;
  draft: FeedDraft;
  message: string;
  issues: string[];
  feedUrl: string | null;
};

export type ModelDraftPatch = Partial<FeedDraft>;

export type ModelDecision = {
  intent: AssistantIntent;
  proposedState: AdaptiveState;
  draftPatch: ModelDraftPatch;
  framing?: string;
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

const isTtl = (value: unknown): value is FeedTtl => isOneOf(value, ALLOWED_TTLS);

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
    isStringArray(value.repos, 25)
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

const isAssistantHistoryTurn = (value: unknown): value is AssistantHistoryTurn => {
  if (!isRecord(value) || !hasAllowedKeys(value, HISTORY_TURN_KEYS, HISTORY_TURN_KEYS)) {
    return false;
  }

  return (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    value.content.length <= 1_000
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
    Array.isArray(value.history) &&
    value.history.length <= 6 &&
    value.history.every(isAssistantHistoryTurn) &&
    isAdaptiveState(value.state) &&
    isFeedDraft(value.draft)
  );
};

const isModelDraftPatch = (value: unknown): value is ModelDraftPatch => {
  if (!isRecord(value) || !hasAllowedKeys(value, FEED_DRAFT_KEYS)) {
    return false;
  }

  if ("source" in value && value.source !== null && !isOneOf(value.source, FEED_SOURCES)) {
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

  return !("topicOperator" in value) || value.topicOperator === "or";
};

export const isModelDecision = (value: unknown): value is ModelDecision => {
  if (
    !isRecord(value) ||
    !hasAllowedKeys(value, MODEL_DECISION_KEYS, ["intent", "proposedState", "draftPatch"])
  ) {
    return false;
  }

  return (
    isOneOf(value.intent, ASSISTANT_INTENTS) &&
    isAdaptiveState(value.proposedState) &&
    isModelDraftPatch(value.draftPatch) &&
    (!("framing" in value) || (typeof value.framing === "string" && value.framing.length <= 240))
  );
};
