import { apiUrl } from "./api";
import { AssistantApiError } from "./error";
import {
  ADAPTIVE_STATES,
  FEED_TTLS,
  LEGAL_TRANSITIONS,
  type AdaptiveState,
  type FeedDraft,
} from "../../../shared/adaptive-contracts";

export {
  ADAPTIVE_STATES,
  DEFAULT_FEED_DRAFT,
  FEED_TTLS,
  LEGAL_TRANSITIONS,
  type AdaptiveState,
  type FeedDraft,
  type FeedTtl,
} from "../../../shared/adaptive-contracts";

export const ASSISTANT_MESSAGE_LIMIT = 1_000;

const FEED_SOURCES = ["topics", "starred"] as const;
const ACTIVITY_TYPES = ["releases", "all"] as const;
const DRAFT_KEYS = [
  "source",
  "topics",
  "username",
  "repoSelection",
  "activityType",
  "ttl",
  "format",
  "topicOperator",
] as const;
const RESPONSE_KEYS = ["state", "draft", "message", "issues", "feedUrl", "showUi"] as const;
const EXPERIMENT_RESPONSE_KEYS = ["adaptiveFeedBuilder"] as const;
const EXPERIMENT_KEY_STORAGE = "ossreleasefeed:experiment-key";
const EXPERIMENT_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const FEED_PATH = /^\/feed\/[A-Za-z0-9_-]+$/u;
const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,34}$/u;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

export type AssistantRole = "user" | "assistant";
export type AssistantHistoryTurn = { role: AssistantRole; content: string };

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
  showUi: boolean;
};

let inMemoryExperimentKey: string | undefined;

const createExperimentKey = (): string => crypto.randomUUID();
const STORAGE_PROVIDERS = [() => window.localStorage, () => window.sessionStorage] as const;

const isValidExperimentKey = (value: string | null): value is string =>
  Boolean(value && EXPERIMENT_KEY.test(value));

const readStoredExperimentKey = (): string | null => {
  for (const getStorage of STORAGE_PROVIDERS) {
    try {
      const storage = getStorage();
      const saved = storage.getItem(EXPERIMENT_KEY_STORAGE);

      if (isValidExperimentKey(saved)) {
        return saved;
      }
    } catch {
      // Continue to the next storage option. The in-memory fallback is always available.
    }
  }

  return null;
};

const persistExperimentKey = (key: string): void => {
  for (const getStorage of STORAGE_PROVIDERS) {
    try {
      const storage = getStorage();
      storage.setItem(EXPERIMENT_KEY_STORAGE, key);
      return;
    } catch {
      // Continue to the next storage option.
    }
  }
};

export const getExperimentKey = (): string => {
  if (inMemoryExperimentKey) {
    return inMemoryExperimentKey;
  }

  const key = readStoredExperimentKey() ?? createExperimentKey();
  persistExperimentKey(key);
  inMemoryExperimentKey = key;

  return key;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value);

  return keys.length === expected.length && keys.every((key) => expected.includes(key));
};

const isOneOf = <T extends string | number>(
  value: unknown,
  allowedValues: readonly T[],
): value is T => allowedValues.some((allowedValue) => allowedValue === value);

const isStringArray = (value: unknown, maximumLength: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= maximumLength &&
  value.every((item) => typeof item === "string");

const isFeedSource = (value: unknown): value is FeedDraft["source"] =>
  value === null || isOneOf(value, FEED_SOURCES);

const isRepoSelection = (value: unknown): value is FeedDraft["repoSelection"] => {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === "all") {
    return hasExactKeys(value, ["kind"]);
  }

  return (
    value.kind === "subset" &&
    hasExactKeys(value, ["kind", "repos"]) &&
    isStringArray(value.repos, 25)
  );
};

export const isSecureFeedUrl = (value: unknown): value is string | null => {
  if (value === null) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    const isSecure = url.protocol === "https:";
    const isLocalDevelopment = url.protocol === "http:" && isOneOf(url.hostname, LOCAL_HOSTS);

    return (
      (isSecure || isLocalDevelopment) &&
      FEED_PATH.test(url.pathname) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};

export const isAdaptiveState = (value: unknown): value is AdaptiveState =>
  isOneOf(value, ADAPTIVE_STATES);

export const isFeedDraft = (value: unknown): value is FeedDraft => {
  if (!isRecord(value) || !hasExactKeys(value, DRAFT_KEYS)) {
    return false;
  }

  if (
    !isFeedSource(value.source) ||
    !isStringArray(value.topics, 5) ||
    !value.topics.every((topic) => TOPIC_SLUG.test(topic)) ||
    new Set(value.topics).size !== value.topics.length
  ) {
    return false;
  }

  if (value.username !== null && typeof value.username !== "string") {
    return false;
  }

  if (!isRepoSelection(value.repoSelection)) {
    return false;
  }

  return (
    isOneOf(value.activityType, ACTIVITY_TYPES) &&
    isOneOf(value.ttl, FEED_TTLS) &&
    value.format === "atom" &&
    value.topicOperator === "or"
  );
};

export const isLegalTransition = (current: AdaptiveState, proposed: AdaptiveState): boolean =>
  LEGAL_TRANSITIONS[current].includes(proposed);

const isAssistantTurnResponse = (value: unknown): value is AssistantTurnResponse => {
  if (!isRecord(value) || !hasExactKeys(value, RESPONSE_KEYS)) {
    return false;
  }

  if (!isOneOf(value.state, ADAPTIVE_STATES) || !isFeedDraft(value.draft)) {
    return false;
  }

  if (typeof value.message !== "string" || value.message.length > 500) {
    return false;
  }

  if (
    !isStringArray(value.issues, 5) ||
    !isSecureFeedUrl(value.feedUrl) ||
    typeof value.showUi !== "boolean"
  ) {
    return false;
  }

  if (value.state === "ready") {
    return (
      value.draft.source === "topics" &&
      value.draft.topics.length > 0 &&
      value.feedUrl !== null &&
      value.showUi
    );
  }

  if (value.feedUrl !== null) {
    return false;
  }

  if (value.state === "idle") {
    return value.draft.source === null;
  }

  if (value.state === "choose-source" || value.state === "recoverable-error") {
    return true;
  }

  if (value.state === "enter-username" || value.state === "choose-repos") {
    return value.draft.source === "starred";
  }

  if (value.state === "edit-topics") {
    return value.draft.source === "topics";
  }

  return value.draft.source === "topics" && value.draft.topics.length > 0;
};

const readRetryAfterSeconds = (response: Response): number | null => {
  const value = response.headers.get("Retry-After");

  if (!value) {
    return null;
  }

  const seconds = Number(value);

  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new AssistantApiError(502);
  }
};

export const fetchExperiments = async (
  experimentKey: string,
  signal: AbortSignal,
): Promise<{ adaptiveFeedBuilder: boolean }> => {
  const response = await fetch(apiUrl("/api/experiments"), {
    headers: { "X-Experiment-Key": experimentKey },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Experiment request failed with ${response.status}`);
  }

  const payload = await readJson(response);

  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, EXPERIMENT_RESPONSE_KEYS) ||
    typeof payload.adaptiveFeedBuilder !== "boolean"
  ) {
    throw new Error("Experiment response did not match expected shape");
  }

  return { adaptiveFeedBuilder: payload.adaptiveFeedBuilder };
};

export const submitAssistantTurn = async (
  request: AssistantTurnRequest,
  experimentKey: string,
  signal: AbortSignal,
): Promise<AssistantTurnResponse> => {
  const response = await fetch(apiUrl("/api/assistant/turn"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Experiment-Key": experimentKey,
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new AssistantApiError(response.status, readRetryAfterSeconds(response));
  }

  const payload = await readJson(response);

  if (!isAssistantTurnResponse(payload)) {
    throw new AssistantApiError(502);
  }

  if (!isLegalTransition(request.state, payload.state)) {
    throw new AssistantApiError(502);
  }

  return payload;
};
