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

export const FEED_TTLS = [3600, 21600, 86400, 604800] as const;

export type AdaptiveState = (typeof ADAPTIVE_STATES)[number];
export type FeedTtl = (typeof FEED_TTLS)[number];

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

export const LEGAL_TRANSITIONS: Readonly<Record<AdaptiveState, readonly AdaptiveState[]>> = {
  idle: [
    "choose-source",
    "edit-topics",
    "enter-username",
    "choose-repos",
    "edit-settings",
    "ready",
    "recoverable-error",
  ],
  "choose-source": [
    "choose-source",
    "edit-topics",
    "enter-username",
    "edit-settings",
    "ready",
    "recoverable-error",
  ],
  "edit-topics": ["choose-source", "edit-topics", "edit-settings", "ready", "recoverable-error"],
  "enter-username": [
    "choose-source",
    "enter-username",
    "choose-repos",
    "edit-topics",
    "edit-settings",
    "ready",
    "recoverable-error",
  ],
  "choose-repos": [
    "choose-source",
    "enter-username",
    "choose-repos",
    "edit-topics",
    "edit-settings",
    "ready",
    "recoverable-error",
  ],
  "edit-settings": [
    "choose-source",
    "edit-topics",
    "enter-username",
    "choose-repos",
    "edit-settings",
    "ready",
    "recoverable-error",
  ],
  ready: [
    "choose-source",
    "edit-topics",
    "enter-username",
    "choose-repos",
    "edit-settings",
    "ready",
    "recoverable-error",
  ],
  "recoverable-error": [
    "choose-source",
    "edit-topics",
    "enter-username",
    "choose-repos",
    "edit-settings",
    "ready",
    "recoverable-error",
  ],
};

export const isRepoSelectionComplete = (selection: FeedDraft["repoSelection"]): boolean =>
  selection?.kind === "all" || (selection?.kind === "subset" && selection.repos.length > 0);

export const editableStateForDraft = (
  draft: FeedDraft,
): "choose-source" | "edit-topics" | "enter-username" | "choose-repos" | "edit-settings" => {
  if (draft.source === null) {
    return "choose-source";
  }

  if (draft.source === "topics") {
    return draft.topics.length > 0 ? "edit-settings" : "edit-topics";
  }

  if (draft.username === null) {
    return "enter-username";
  }

  return isRepoSelectionComplete(draft.repoSelection) ? "edit-settings" : "choose-repos";
};

export const isStateConsistentWithDraft = (
  state: AdaptiveState,
  draft: FeedDraft,
  ttlSelected: boolean,
): boolean => {
  const branchConsistent =
    (draft.source === null &&
      draft.topics.length === 0 &&
      draft.username === null &&
      draft.repoSelection === null) ||
    (draft.source === "topics" && draft.username === null && draft.repoSelection === null) ||
    (draft.source === "starred" && draft.topics.length === 0);

  if (!branchConsistent) {
    return false;
  }

  if (state === "recoverable-error") {
    return true;
  }

  if (state === "idle" || state === "choose-source") {
    return draft.source === null;
  }

  if (draft.source === "topics") {
    if (state === "edit-topics") {
      return true;
    }

    if (state === "edit-settings") {
      return draft.topics.length > 0;
    }

    return state === "ready" && draft.topics.length > 0 && ttlSelected;
  }

  if (draft.source === "starred") {
    if (state === "enter-username") {
      return true;
    }

    if (state === "choose-repos") {
      return draft.username !== null;
    }

    if (state === "edit-settings") {
      return draft.username !== null && isRepoSelectionComplete(draft.repoSelection);
    }

    return (
      state === "ready" &&
      draft.username !== null &&
      isRepoSelectionComplete(draft.repoSelection) &&
      ttlSelected
    );
  }

  return false;
};
