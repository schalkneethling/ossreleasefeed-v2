import {
  FEED_TTLS,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
  type FeedDraft,
  type FeedTtl,
  type ModelDecision,
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

// Suggested replies are application-owned copy. A suggestion's text is both
// the chip label and the exact message submitted when the chip is clicked.
export const SUGGEST_TOPIC_FEED = "Create a topic feed";
export const SUGGEST_STARRED_FEED = "Use starred repositories";
export const SUGGEST_LIST_TOPICS = "Which topics are available?";
export const SUGGEST_SHOW_UI = "Show UI";
export const SUGGEST_ALL_REPOSITORIES = "Include all of them";
export const SUGGEST_FIRST_TEN_REPOSITORIES = "Select the first 10";
export const SUGGEST_LIST_REPOSITORIES = "Show me the repositories";
export const SUGGEST_START_OVER = "Start over";
export const SUGGEST_TTL_LABELS: Readonly<Record<FeedTtl, string>> = {
  3600: "1 hour",
  21600: "6 hours",
  86400: "24 hours",
  604800: "1 week",
};
export const MAX_SUGGESTIONS = 4;

const SUGGESTIONS_BY_DECISION: Readonly<Record<AssistantRequiredDecision, readonly string[]>> = {
  "feed-source": [SUGGEST_TOPIC_FEED, SUGGEST_STARRED_FEED],
  "topic-selection": [SUGGEST_LIST_TOPICS, SUGGEST_SHOW_UI],
  "github-username": [SUGGEST_SHOW_UI],
  "repository-selection": [
    SUGGEST_ALL_REPOSITORIES,
    SUGGEST_FIRST_TEN_REPOSITORIES,
    SUGGEST_LIST_REPOSITORIES,
  ],
  "feed-settings": FEED_TTLS.map((ttl) => SUGGEST_TTL_LABELS[ttl]),
  recovery: [SUGGEST_SHOW_UI],
  "complete-feed": [SUGGEST_START_OVER],
};

// What the application asks for at each required decision. The Jev state and
// the clarify reply both use it, so the question is re-derived, never stored.
const PROMPTS_BY_DECISION: Readonly<Record<AssistantRequiredDecision, string>> = {
  "feed-source":
    "Do you want a feed built from GitHub topics, or from a GitHub user's starred repositories?",
  "topic-selection": "Which GitHub topics should this feed follow?",
  "github-username": "Which GitHub username's starred repositories should this feed use?",
  "repository-selection":
    "Should the feed include all of this user's starred repositories, or only specific ones?",
  "feed-settings": "How often should the feed update: 1 hour, 6 hours, 24 hours, or 1 week?",
  recovery: "Something could not be used. How would you like to correct it?",
  "complete-feed": "The feed is ready. Would you like to change anything?",
};

export const promptFor = (requiredDecision: AssistantRequiredDecision): string =>
  PROMPTS_BY_DECISION[requiredDecision];

type WorkflowPosition = Pick<AssistantTurnRequest, "state" | "draft" | "issues" | "ttlSelected">;

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
}: WorkflowPosition): AssistantRequiredDecision => {
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

// Keyed by the required decision of the response, so a chip always answers
// the question the person is looking at. Interpreter hints come first.
export const suggestionsFor = (
  response: WorkflowPosition & { showUi: boolean },
  hints: readonly string[] = [],
): string[] => {
  const catalogue = SUGGESTIONS_BY_DECISION[requiredDecisionFor(response)];
  const suggestions = new Set<string>();

  for (const suggestion of [...hints, ...catalogue]) {
    if (suggestion === SUGGEST_SHOW_UI && response.showUi) {
      continue;
    }

    suggestions.add(suggestion);
  }

  return [...suggestions].slice(0, MAX_SUGGESTIONS);
};

type ResponseOptions = {
  ttlSelected: boolean;
  issues?: string[];
  feedUrl?: string | null;
  showUi?: boolean;
  hints?: readonly string[];
};

export const responseFor = (
  state: AssistantTurnResponse["state"],
  draft: FeedDraft,
  message: string,
  { ttlSelected, issues = [], feedUrl = null, showUi = false, hints = [] }: ResponseOptions,
): AssistantTurnResponse => ({
  state,
  draft,
  message,
  issues,
  feedUrl,
  showUi,
  ttlSelected,
  suggestions: suggestionsFor({ state, draft, issues, ttlSelected, showUi }, hints),
});

type CannedDecision = {
  requiredDecision: AssistantRequiredDecision;
  decision: ModelDecision;
};

const cannedTtl = (ttl: FeedTtl): [string, CannedDecision] => [
  SUGGEST_TTL_LABELS[ttl].toLowerCase(),
  {
    requiredDecision: "feed-settings",
    decision: { intent: "create-or-update-feed", draftPatch: { ttl } },
  },
];

// A chip's meaning is known, so its decision is fixed here and inference is
// skipped. Each entry applies only at the required decision that offers it;
// anywhere else the same words are interpreted like any other message.
const CANNED_DECISIONS: ReadonlyMap<string, CannedDecision> = new Map([
  [
    SUGGEST_TOPIC_FEED.toLowerCase(),
    {
      requiredDecision: "feed-source",
      decision: { intent: "create-or-update-feed", draftPatch: { source: "topics" } },
    },
  ],
  [
    SUGGEST_STARRED_FEED.toLowerCase(),
    {
      requiredDecision: "feed-source",
      decision: { intent: "create-or-update-feed", draftPatch: { source: "starred" } },
    },
  ],
  [
    SUGGEST_LIST_TOPICS.toLowerCase(),
    { requiredDecision: "topic-selection", decision: { intent: "list-topics", draftPatch: {} } },
  ],
  [
    SUGGEST_ALL_REPOSITORIES.toLowerCase(),
    {
      requiredDecision: "repository-selection",
      decision: {
        intent: "create-or-update-feed",
        draftPatch: {},
        repoSelectionAction: { kind: "all" },
      },
    },
  ],
  [
    SUGGEST_FIRST_TEN_REPOSITORIES.toLowerCase(),
    {
      requiredDecision: "repository-selection",
      decision: {
        intent: "create-or-update-feed",
        draftPatch: {},
        repoSelectionAction: { kind: "first", count: 10 },
      },
    },
  ],
  [
    SUGGEST_LIST_REPOSITORIES.toLowerCase(),
    {
      requiredDecision: "repository-selection",
      decision: { intent: "list-repositories", draftPatch: {} },
    },
  ],
  ...FEED_TTLS.map(cannedTtl),
]);

export const cannedDecisionFor = (
  message: string,
  requiredDecision: AssistantRequiredDecision,
): ModelDecision | null => {
  const canned = CANNED_DECISIONS.get(message.trim().toLowerCase());

  if (canned === undefined || canned.requiredDecision !== requiredDecision) {
    return null;
  }

  // A copy, so a caller can never alter the table.
  return structuredClone(canned.decision);
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
