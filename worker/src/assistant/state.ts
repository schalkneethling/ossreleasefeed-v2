import {
  DEFAULT_FEED_DRAFT,
  type AdaptiveState,
  type FeedDraft,
  type ModelDraftPatch,
} from "./contracts";
import { LEGAL_TRANSITIONS } from "../../../shared/adaptive-contracts";

export { isStateConsistentWithDraft, LEGAL_TRANSITIONS } from "../../../shared/adaptive-contracts";

export const isLegalTransition = (current: AdaptiveState, proposed: AdaptiveState): boolean =>
  current === proposed || LEGAL_TRANSITIONS[current].includes(proposed);

export const normalizeTopics = (topics: readonly string[]): string[] => [
  ...new Set(topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean)),
];

export const applyDraftPatch = (current: FeedDraft, patch: ModelDraftPatch): FeedDraft => {
  const hasExplicitSource = "source" in patch;
  const hasTopicSelection = Array.isArray(patch.topics) && patch.topics.length > 0;
  const hasStarredSelection =
    ("username" in patch && patch.username !== null) ||
    ("repoSelection" in patch && patch.repoSelection !== null);
  const inferredSource = hasTopicSelection
    ? "topics"
    : hasStarredSelection
      ? "starred"
      : current.source;
  const source = hasExplicitSource ? patch.source : inferredSource;
  const topics = patch.topics ? normalizeTopics(patch.topics) : current.topics;
  const next: FeedDraft = {
    ...DEFAULT_FEED_DRAFT,
    ...current,
    ...patch,
    source: hasExplicitSource
      ? (source ?? null)
      : (source ?? (topics.length > 0 ? "topics" : null)),
    topics,
    format: "atom",
    topicOperator: "or",
  };

  if (next.source === null) {
    next.topics = [];
    next.username = null;
    next.repoSelection = null;
  }

  if (next.source === "topics") {
    next.username = null;
    next.repoSelection = null;
  }

  if (next.source === "starred") {
    next.topics = [];

    if (
      "username" in patch &&
      current.username !== null &&
      patch.username !== current.username &&
      !("repoSelection" in patch)
    ) {
      next.repoSelection = null;
    }
  }

  return next;
};
