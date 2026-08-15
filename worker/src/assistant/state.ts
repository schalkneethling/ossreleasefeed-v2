import {
  DEFAULT_FEED_DRAFT,
  type AdaptiveState,
  type FeedDraft,
  type ModelDraftPatch,
} from "./contracts";
import { LEGAL_TRANSITIONS } from "../../../shared/adaptive-contracts";

export { LEGAL_TRANSITIONS } from "../../../shared/adaptive-contracts";

export const isLegalTransition = (current: AdaptiveState, proposed: AdaptiveState): boolean =>
  current === proposed || LEGAL_TRANSITIONS[current].includes(proposed);

export const normalizeTopics = (topics: readonly string[]): string[] => [
  ...new Set(topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean)),
];

export const applyDraftPatch = (current: FeedDraft, patch: ModelDraftPatch): FeedDraft => {
  const hasExplicitSource = "source" in patch;
  const source = hasExplicitSource ? (patch.source ?? null) : current.source;
  const topics = patch.topics ? normalizeTopics(patch.topics) : current.topics;
  const next: FeedDraft = {
    ...DEFAULT_FEED_DRAFT,
    ...current,
    ...patch,
    source: hasExplicitSource ? source : (source ?? (topics.length > 0 ? "topics" : null)),
    topics,
    format: "atom",
    topicOperator: "or",
  };

  if (next.source === "topics") {
    next.username = null;
    next.repoSelection = null;
  }

  if (next.source === "starred") {
    next.topics = [];
  }

  return next;
};

export const isStateConsistentWithDraft = (state: AdaptiveState, draft: FeedDraft): boolean => {
  if (state === "recoverable-error") {
    return true;
  }

  if (draft.source === null) {
    return state === "choose-source";
  }

  if (draft.source === "starred") {
    return state === "enter-username" || state === "choose-repos";
  }

  if (draft.topics.length === 0) {
    return state === "edit-topics";
  }

  return state === "edit-topics" || state === "edit-settings" || state === "ready";
};
