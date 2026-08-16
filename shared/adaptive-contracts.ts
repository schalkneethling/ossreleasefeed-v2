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
