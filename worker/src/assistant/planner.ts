import type {
  AssistantTurnRequest,
  AssistantTurnResponse,
  FeedDraft,
  ModelDecision,
} from "./contracts";
import { encodeFeedConfig } from "../lib/config";
import {
  type AssistantRequiredDecision,
  isRepoSelectionComplete,
} from "../../../shared/adaptive-contracts";

export const TOPIC_LIMIT_ISSUE = "Use between one and five GitHub topic slugs.";
export const SETTINGS_ISSUE = "Choose 1 hour, 6 hours, 24 hours, or 1 week.";
export const SETTINGS_OPTIONS_MESSAGE =
  "The feed can update every 1 hour, 6 hours, 24 hours, or 1 week. Tell me which frequency you want, or ask me to show the settings UI.";
export const CAPABILITIES_MESSAGE =
  "You can create feeds by GitHub topic or from a user's starred repositories. Describe the topics or the GitHub username you want to follow.";

type ResponseOptions = {
  ttlSelected: boolean;
  issues?: string[];
  feedUrl?: string | null;
  showUi?: boolean;
};

export const responseFor = (
  state: AssistantTurnResponse["state"],
  draft: FeedDraft,
  message: string,
  { ttlSelected, issues = [], feedUrl = null, showUi = false }: ResponseOptions,
): AssistantTurnResponse => ({
  state,
  draft,
  message,
  issues,
  feedUrl,
  showUi,
  ttlSelected,
});

const formatItemList = (items: readonly string[]): string => {
  if (items.length === 1) {
    return items[0];
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
};

export const selectionMessage = (
  items: readonly string[],
  singular: string,
  plural: string,
): string => {
  const selection =
    items.length === 1
      ? `I selected the ${singular} ${items[0]}.`
      : `I selected ${items.length} ${plural}: ${formatItemList(items)}.`;

  return `${selection} Next, choose how often the feed should update. I can show you the settings UI or list the available options.`;
};

export const unsupportedDetails = (
  decision: ModelDecision,
  source: Exclude<FeedDraft["source"], null>,
): { message: string; issue: string } => {
  if (decision.unsupportedReason === "interval") {
    return { message: "That update frequency is not available.", issue: SETTINGS_ISSUE };
  }

  return source === "starred"
    ? {
        message: "I couldn't safely apply that request.",
        issue: "Try changing the repository selection, activity, or update frequency.",
      }
    : {
        message: "I couldn't safely apply that request.",
        issue: "Try changing the topics, activity, or update frequency.",
      };
};

export const requiredDecisionFor = ({
  state,
  draft,
  issues,
  ttlSelected,
}: AssistantTurnRequest): AssistantRequiredDecision => {
  if (draft.source === null) {
    return "feed-source" as const;
  }

  if (draft.source === "topics") {
    if (draft.topics.length === 0 || (state === "edit-topics" && issues.length > 0)) {
      return "topic-selection" as const;
    }
  }

  if (draft.source === "starred") {
    if (draft.username === null || (state === "enter-username" && issues.length > 0)) {
      return "github-username" as const;
    }

    if (!isRepoSelectionComplete(draft.repoSelection)) {
      return "repository-selection" as const;
    }
  }

  if (state === "recoverable-error" || issues.length > 0) {
    return "recovery" as const;
  }

  if (!ttlSelected || state === "edit-settings") {
    return "feed-settings" as const;
  }

  return "complete-feed" as const;
};

export const stateForVisibleUi = (payload: AssistantTurnRequest) => {
  const requiredDecision = requiredDecisionFor(payload);

  if (requiredDecision === "feed-source") {
    return "choose-source" as const;
  }

  if (requiredDecision === "topic-selection") {
    return "edit-topics" as const;
  }

  if (requiredDecision === "github-username") {
    return "enter-username" as const;
  }

  if (requiredDecision === "repository-selection") {
    return "choose-repos" as const;
  }

  if (payload.draft.source !== null) {
    return "edit-settings" as const;
  }

  return "choose-source" as const;
};

const READ_ONLY_INTENTS = new Set<ModelDecision["intent"]>([
  "explain-capabilities",
  "list-topics",
  "list-repositories",
  "list-settings",
  "show-ui",
  "hide-ui",
]);

export const normalizeModelPatch = (
  patch: ModelDecision["draftPatch"],
): ModelDecision["draftPatch"] => {
  const normalized = { ...patch };

  if (normalized.topics?.length === 0) {
    delete normalized.topics;
  }

  if (normalized.username === null) {
    delete normalized.username;
  }

  if (normalized.repoSelection === null) {
    delete normalized.repoSelection;
  }

  if (normalized.format === "atom") {
    delete normalized.format;
  }

  if (normalized.topicOperator === "or") {
    delete normalized.topicOperator;
  }

  return normalized;
};

export const mergeRepositoryNames = (
  current: readonly string[],
  additions: readonly string[],
): string[] => {
  const merged = new Map<string, string>();

  for (const repository of current) {
    merged.set(repository.toLowerCase(), repository);
  }

  for (const repository of additions) {
    const key = repository.toLowerCase();

    if (!merged.has(key)) {
      merged.set(key, repository);
    }
  }

  return [...merged.values()];
};

export const isReadOnlyDecisionValid = (decision: ModelDecision): boolean =>
  !READ_ONLY_INTENTS.has(decision.intent) ||
  (Object.keys(normalizeModelPatch(decision.draftPatch)).length === 0 &&
    decision.repoSelectionAction === undefined);

export const canFinalizeDraft = (payload: AssistantTurnRequest): boolean => {
  if (!payload.ttlSelected || payload.issues.length > 0) {
    return false;
  }

  if (payload.draft.source === "topics") {
    return payload.draft.topics.length > 0;
  }

  return (
    payload.draft.source === "starred" &&
    payload.draft.username !== null &&
    isRepoSelectionComplete(payload.draft.repoSelection)
  );
};

export const createTopicFeedUrl = (draft: FeedDraft, requestUrl: string): string => {
  const token = encodeFeedConfig({
    source: "topics",
    topics: draft.topics,
    topicOperator: "or",
    activityType: draft.activityType,
    ttl: draft.ttl,
    format: "atom",
  });

  return new URL(`/feed/${token}`, requestUrl).toString();
};

export const createStarredFeedUrl = (draft: FeedDraft, requestUrl: string): string | null => {
  if (draft.username === null) {
    return null;
  }

  const token = encodeFeedConfig({
    source: "starred",
    username: draft.username,
    repos: draft.repoSelection?.kind === "subset" ? draft.repoSelection.repos : null,
    activityType: draft.activityType,
    ttl: draft.ttl,
    format: "atom",
  });

  return new URL(`/feed/${token}`, requestUrl).toString();
};
