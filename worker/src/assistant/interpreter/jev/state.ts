import type { FeedDraft, FeedTtl } from "../../contracts";
import type { AssistantRequiredDecision } from "./types";
import type { TurnCandidates } from "./candidates";

// Bump when a branch is added, renamed, or changes meaning; evaluation runs
// record it next to the question-set hash.
export const JEV_STATE_VERSION = 1;

export const FREQUENCY_LABELS: Readonly<Record<FeedTtl, string>> = {
  3600: "1 hour",
  21600: "6 hours",
  86400: "24 hours",
  604800: "1 week",
};

// The application re-derives what it last asked from the validated draft. The
// client transcript is presentation state and is never forwarded.
const APP_QUESTIONS: Readonly<Record<AssistantRequiredDecision, string>> = {
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

export type JevState = {
  user_message: { text: string };
  app_just_asked: { decision: AssistantRequiredDecision; question: string };
  feed_so_far: {
    feed_type: "GitHub topics" | "starred repositories" | null;
    topics: string[];
    github_username: string | null;
    repositories: "all starred repositories" | string[] | null;
    activity: "releases only" | "all activity";
    update_frequency: string | null;
    open_issues: string[];
  };
  candidates: { topics: string[]; usernames: string[] };
  product: {
    feed_types: string[];
    update_frequencies: string[];
    activity_types: string[];
  };
};

export type JevTurn = {
  message: string;
  draft: FeedDraft;
  issues: readonly string[];
  ttlSelected: boolean;
  requiredDecision: AssistantRequiredDecision;
};

const feedType = (source: FeedDraft["source"]): JevState["feed_so_far"]["feed_type"] => {
  if (source === null) {
    return null;
  }

  return source === "topics" ? "GitHub topics" : "starred repositories";
};

const repositories = (
  selection: FeedDraft["repoSelection"],
): JevState["feed_so_far"]["repositories"] => {
  if (selection === null) {
    return null;
  }

  return selection.kind === "all" ? "all starred repositories" : [...selection.repos];
};

export const buildJevState = (turn: JevTurn, candidates: TurnCandidates): JevState => ({
  user_message: { text: turn.message },
  app_just_asked: {
    decision: turn.requiredDecision,
    question: APP_QUESTIONS[turn.requiredDecision],
  },
  feed_so_far: {
    feed_type: feedType(turn.draft.source),
    topics: [...turn.draft.topics],
    github_username: turn.draft.username,
    repositories: repositories(turn.draft.repoSelection),
    activity: turn.draft.activityType === "all" ? "all activity" : "releases only",
    // The stored one-hour value is a control default, not a user choice.
    update_frequency: turn.ttlSelected ? FREQUENCY_LABELS[turn.draft.ttl] : null,
    open_issues: [...turn.issues],
  },
  candidates: {
    topics: candidates.topics.map((candidate) => candidate.slug),
    usernames: [...candidates.usernames],
  },
  product: {
    feed_types: ["GitHub topics", "a GitHub user's starred repositories"],
    update_frequencies: Object.values(FREQUENCY_LABELS),
    activity_types: ["releases only", "all activity (releases, issues, and pull requests)"],
  },
});
