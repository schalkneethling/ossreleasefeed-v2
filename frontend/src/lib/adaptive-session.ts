import {
  DEFAULT_FEED_DRAFT,
  type AdaptiveState,
  type AssistantHistoryTurn,
  type AssistantTurnResponse,
  type FeedDraft,
  isAdaptiveState,
  isFeedDraft,
  isLegalTransition,
} from "./assistant";

export const ADAPTIVE_SESSION_STORAGE_KEY = "ossreleasefeed:adaptive-session";
export const ADAPTIVE_SESSION_VERSION = 1;
export const ADAPTIVE_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const TRANSCRIPT_MAX_TURNS = 12;
export const TRANSCRIPT_MAX_CHARACTERS = 6_000;

const MAX_COMPOSER_CHARACTERS = 10_000;
const MAX_ISSUES = 5;

export type InteractionMode = "guided" | "ask";

export type AdaptiveWorkspace = {
  adaptiveState: AdaptiveState;
  draft: FeedDraft;
  feedUrl: string | null;
  transcript: AssistantHistoryTurn[];
  composer: string;
  issues: string[];
  selectedMode: InteractionMode;
  builderStarted: boolean;
};

export const DEFAULT_ADAPTIVE_WORKSPACE: AdaptiveWorkspace = {
  adaptiveState: "idle",
  draft: DEFAULT_FEED_DRAFT,
  feedUrl: null,
  transcript: [],
  composer: "",
  issues: [],
  selectedMode: "guided",
  builderStarted: false,
};

export type AdaptiveAction =
  | { type: "restore"; workspace: AdaptiveWorkspace }
  | { type: "select-mode"; mode: InteractionMode }
  | { type: "start-guided" }
  | { type: "fallback-guided" }
  | { type: "set-composer"; composer: string }
  | { type: "set-source"; source: FeedDraft["source"] }
  | { type: "set-topics"; topics: string[] }
  | { type: "set-activity"; activityType: FeedDraft["activityType"] }
  | { type: "set-ttl"; ttl: FeedDraft["ttl"] }
  | { type: "set-feed-url"; feedUrl: string }
  | { type: "assistant-result"; userMessage: string; response: AssistantTurnResponse }
  | { type: "reset" };

type PersistedAdaptiveWorkspace = AdaptiveWorkspace & {
  version: typeof ADAPTIVE_SESSION_VERSION;
  savedAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown, maximumLength: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= maximumLength &&
  value.every((item) => typeof item === "string");

const isHistoryTurn = (value: unknown): value is AssistantHistoryTurn => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    value.content.length <= 1_000
  );
};

const isFeedUrl = (value: unknown): value is string | null => {
  if (value === null) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    const secure = url.protocol === "https:";
    const loopback =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");

    return (
      (secure || loopback) &&
      /^\/feed\/[A-Za-z0-9_-]+$/u.test(url.pathname) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};

export const capTranscript = (
  transcript: readonly AssistantHistoryTurn[],
): AssistantHistoryTurn[] => {
  const kept: AssistantHistoryTurn[] = [];
  let characters = 0;

  for (const turn of [...transcript].reverse()) {
    if (kept.length >= TRANSCRIPT_MAX_TURNS) {
      break;
    }

    if (characters + turn.content.length > TRANSCRIPT_MAX_CHARACTERS) {
      break;
    }

    kept.push(turn);
    characters += turn.content.length;
  }

  return kept.reverse();
};

const stateForDraftChange = (draft: FeedDraft): AdaptiveState => {
  if (draft.source === null) {
    return "choose-source";
  }

  if (draft.source === "starred") {
    return "enter-username";
  }

  return draft.topics.length > 0 ? "edit-settings" : "edit-topics";
};

const updateDraft = (
  workspace: AdaptiveWorkspace,
  patch: Partial<FeedDraft>,
): AdaptiveWorkspace => {
  const draft: FeedDraft = {
    ...workspace.draft,
    ...patch,
    format: "atom",
    topicOperator: "or",
  };

  if (draft.source === "topics") {
    draft.username = null;
    draft.repoSelection = null;
  }

  if (draft.source === "starred") {
    draft.topics = [];
  }

  return {
    ...workspace,
    adaptiveState: stateForDraftChange(draft),
    draft,
    feedUrl: null,
    issues: [],
  };
};

const assistantTranscript = (
  workspace: AdaptiveWorkspace,
  userMessage: string,
  response: AssistantTurnResponse,
): AssistantHistoryTurn[] => {
  const issueText = response.issues.length > 0 ? ` ${response.issues.join(" ")}` : "";

  return capTranscript([
    ...workspace.transcript,
    { role: "user", content: userMessage },
    { role: "assistant", content: `${response.message}${issueText}` },
  ]);
};

export const adaptiveWorkspaceReducer = (
  workspace: AdaptiveWorkspace,
  action: AdaptiveAction,
): AdaptiveWorkspace => {
  switch (action.type) {
    case "restore": {
      return action.workspace;
    }
    case "select-mode": {
      return { ...workspace, selectedMode: action.mode };
    }
    case "start-guided": {
      return { ...workspace, builderStarted: true, selectedMode: "guided" };
    }
    case "fallback-guided": {
      return { ...workspace, builderStarted: true, selectedMode: "guided" };
    }
    case "set-composer": {
      return { ...workspace, composer: action.composer };
    }
    case "set-source": {
      if (action.source === "topics") {
        return updateDraft(workspace, {
          source: "topics",
          username: null,
          repoSelection: null,
        });
      }

      if (action.source === "starred") {
        return updateDraft(workspace, { source: "starred", topics: [] });
      }

      return updateDraft(workspace, {
        source: null,
        topics: [],
        username: null,
        repoSelection: null,
      });
    }
    case "set-topics": {
      return updateDraft(workspace, { source: "topics", topics: [...action.topics] });
    }
    case "set-activity": {
      return updateDraft(workspace, { activityType: action.activityType });
    }
    case "set-ttl": {
      return updateDraft(workspace, { ttl: action.ttl });
    }
    case "set-feed-url": {
      return { ...workspace, adaptiveState: "ready", feedUrl: action.feedUrl, issues: [] };
    }
    case "assistant-result": {
      if (!isLegalTransition(workspace.adaptiveState, action.response.state)) {
        return { ...workspace, adaptiveState: "recoverable-error", feedUrl: null };
      }

      return {
        ...workspace,
        adaptiveState: action.response.state,
        draft: action.response.draft,
        feedUrl: action.response.feedUrl,
        transcript: assistantTranscript(workspace, action.userMessage, action.response),
        composer: "",
        issues: action.response.issues,
      };
    }
    case "reset": {
      return { ...DEFAULT_ADAPTIVE_WORKSPACE, selectedMode: workspace.selectedMode };
    }
  }
};

const isInteractionMode = (value: unknown): value is InteractionMode =>
  value === "guided" || value === "ask";

const isStateConsistentWithWorkspace = (
  state: AdaptiveState,
  draft: FeedDraft,
  feedUrl: string | null,
): boolean => {
  if (feedUrl !== null) {
    return state === "ready" && draft.source === "topics" && draft.topics.length > 0;
  }

  if (state === "ready") {
    return false;
  }

  if (state === "idle") {
    return draft.source === null;
  }

  if (state === "recoverable-error") {
    return true;
  }

  if (state === "choose-source") {
    return true;
  }

  if (draft.source === null) {
    return false;
  }

  if (draft.source === "starred") {
    return state === "enter-username" || state === "choose-repos";
  }

  if (draft.topics.length === 0) {
    return state === "edit-topics";
  }

  return state === "edit-topics" || state === "edit-settings";
};

const isPersistedWorkspace = (value: unknown, now: number): value is PersistedAdaptiveWorkspace => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.version !== ADAPTIVE_SESSION_VERSION ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    value.savedAt > now ||
    now - value.savedAt > ADAPTIVE_SESSION_MAX_AGE_MS
  ) {
    return false;
  }

  if (!isAdaptiveState(value.adaptiveState) || !isFeedDraft(value.draft)) {
    return false;
  }

  if (!isFeedUrl(value.feedUrl) || !isInteractionMode(value.selectedMode)) {
    return false;
  }

  if (!isStateConsistentWithWorkspace(value.adaptiveState, value.draft, value.feedUrl)) {
    return false;
  }

  if (typeof value.builderStarted !== "boolean" || typeof value.composer !== "string") {
    return false;
  }

  if (value.composer.length > MAX_COMPOSER_CHARACTERS) {
    return false;
  }

  return (
    Array.isArray(value.transcript) &&
    value.transcript.every(isHistoryTurn) &&
    isStringArray(value.issues, MAX_ISSUES)
  );
};

export const parsePersistedWorkspace = (
  serialized: string,
  now = Date.now(),
): AdaptiveWorkspace | null => {
  try {
    const parsed: unknown = JSON.parse(serialized);

    if (!isPersistedWorkspace(parsed, now)) {
      return null;
    }

    return {
      adaptiveState: parsed.adaptiveState,
      draft: parsed.draft,
      feedUrl: parsed.feedUrl,
      transcript: capTranscript(parsed.transcript),
      composer: parsed.composer,
      issues: parsed.issues,
      selectedMode: parsed.selectedMode,
      builderStarted: parsed.builderStarted,
    };
  } catch {
    return null;
  }
};

export const loadAdaptiveWorkspace = (): AdaptiveWorkspace | null => {
  try {
    const serialized = window.localStorage.getItem(ADAPTIVE_SESSION_STORAGE_KEY);

    if (!serialized) {
      return null;
    }

    const workspace = parsePersistedWorkspace(serialized);

    if (!workspace) {
      window.localStorage.removeItem(ADAPTIVE_SESSION_STORAGE_KEY);
    }

    return workspace;
  } catch {
    return null;
  }
};

export const persistAdaptiveWorkspace = (workspace: AdaptiveWorkspace, now = Date.now()): void => {
  const persisted: PersistedAdaptiveWorkspace = {
    ...workspace,
    transcript: capTranscript(workspace.transcript),
    version: ADAPTIVE_SESSION_VERSION,
    savedAt: now,
  };

  try {
    window.localStorage.setItem(ADAPTIVE_SESSION_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // The experiment remains usable without persistence.
  }
};

export const clearAdaptiveWorkspace = (): void => {
  try {
    window.localStorage.removeItem(ADAPTIVE_SESSION_STORAGE_KEY);
  } catch {
    // There is no persisted state to clear when storage is unavailable.
  }
};
