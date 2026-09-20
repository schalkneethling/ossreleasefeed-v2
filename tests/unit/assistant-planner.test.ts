import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_DRAFT,
  isModelDecision,
  type AdaptiveState,
  type FeedDraft,
  type ModelDecision,
} from "../../worker/src/assistant/contracts";
import {
  MAX_SUGGESTIONS,
  SUGGEST_ALL_REPOSITORIES,
  SUGGEST_FIRST_TEN_REPOSITORIES,
  SUGGEST_LIST_REPOSITORIES,
  SUGGEST_LIST_TOPICS,
  SUGGEST_SHOW_UI,
  SUGGEST_STARRED_FEED,
  SUGGEST_START_OVER,
  SUGGEST_TOPIC_FEED,
  SUGGEST_TTL_LABELS,
  cannedDecisionFor,
  promptFor,
  requiredDecisionFor,
  responseFor,
  suggestionsFor,
} from "../../worker/src/assistant/planner";
import type { AssistantRequiredDecision } from "../../shared/adaptive-contracts";

type Position = {
  state: AdaptiveState;
  draft: FeedDraft;
  issues: string[];
  ttlSelected: boolean;
  showUi: boolean;
};

const topicsDraft: FeedDraft = { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] };
const starredDraft: FeedDraft = { ...DEFAULT_FEED_DRAFT, source: "starred", username: "octocat" };

// One workflow position per required decision.
const POSITIONS: Readonly<Record<AssistantRequiredDecision, Position>> = {
  "feed-source": {
    state: "choose-source",
    draft: DEFAULT_FEED_DRAFT,
    issues: [],
    ttlSelected: false,
    showUi: false,
  },
  "topic-selection": {
    state: "edit-topics",
    draft: { ...DEFAULT_FEED_DRAFT, source: "topics" },
    issues: [],
    ttlSelected: false,
    showUi: false,
  },
  "github-username": {
    state: "enter-username",
    draft: { ...DEFAULT_FEED_DRAFT, source: "starred" },
    issues: [],
    ttlSelected: false,
    showUi: false,
  },
  "repository-selection": {
    state: "choose-repos",
    draft: starredDraft,
    issues: [],
    ttlSelected: false,
    showUi: false,
  },
  "feed-settings": {
    state: "edit-settings",
    draft: topicsDraft,
    issues: [],
    ttlSelected: false,
    showUi: false,
  },
  recovery: {
    state: "edit-settings",
    draft: topicsDraft,
    issues: ["Choose 1 hour, 6 hours, 24 hours, or 1 week."],
    ttlSelected: false,
    showUi: false,
  },
  "complete-feed": {
    state: "ready",
    draft: topicsDraft,
    issues: [],
    ttlSelected: true,
    showUi: false,
  },
};

const CATALOGUE: Readonly<Record<AssistantRequiredDecision, string[]>> = {
  "feed-source": ["Create a topic feed", "Use starred repositories"],
  "topic-selection": ["Which topics are available?", "Show UI"],
  "github-username": ["Show UI"],
  "repository-selection": [
    "Include all of them",
    "Select the first 10",
    "Show me the repositories",
  ],
  "feed-settings": ["1 hour", "6 hours", "24 hours", "1 week"],
  recovery: ["Show UI"],
  "complete-feed": ["Start over"],
};

const DECISIONS = Object.keys(CATALOGUE) as AssistantRequiredDecision[];

describe("catalogue constants", () => {
  it("match the fixed contract strings", () => {
    expect(SUGGEST_TOPIC_FEED).toBe("Create a topic feed");
    expect(SUGGEST_STARRED_FEED).toBe("Use starred repositories");
    expect(SUGGEST_LIST_TOPICS).toBe("Which topics are available?");
    expect(SUGGEST_SHOW_UI).toBe("Show UI");
    expect(SUGGEST_ALL_REPOSITORIES).toBe("Include all of them");
    expect(SUGGEST_FIRST_TEN_REPOSITORIES).toBe("Select the first 10");
    expect(SUGGEST_LIST_REPOSITORIES).toBe("Show me the repositories");
    expect(SUGGEST_START_OVER).toBe("Start over");
    expect(SUGGEST_TTL_LABELS).toEqual({
      3600: "1 hour",
      21600: "6 hours",
      86400: "24 hours",
      604800: "1 week",
    });
    expect(MAX_SUGGESTIONS).toBe(4);
  });
});

describe("suggestionsFor", () => {
  it.each(DECISIONS)("returns the catalogue for %s", (decision) => {
    const position = POSITIONS[decision];

    // The fixture really is at the required decision it is filed under.
    expect(requiredDecisionFor(position)).toBe(decision);
    expect(suggestionsFor(position)).toEqual(CATALOGUE[decision]);
  });

  it.each(DECISIONS)("omits Show UI for %s when the interface is already visible", (decision) => {
    const suggestions = suggestionsFor({ ...POSITIONS[decision], showUi: true });

    expect(suggestions).toEqual(CATALOGUE[decision].filter((entry) => entry !== "Show UI"));
    expect(suggestions).not.toContain("Show UI");
  });

  it("omits a hinted Show UI as well when the interface is visible", () => {
    expect(suggestionsFor({ ...POSITIONS.recovery, showUi: true }, ["Show UI"])).toEqual([]);
  });

  it("places hints before the catalogue", () => {
    expect(suggestionsFor(POSITIONS["feed-source"], ["24 hours"])).toEqual([
      "24 hours",
      "Create a topic feed",
      "Use starred repositories",
    ]);
  });

  it("de-duplicates a hint that the catalogue also offers, keeping the hint's position", () => {
    expect(suggestionsFor(POSITIONS["feed-source"], ["Use starred repositories"])).toEqual([
      "Use starred repositories",
      "Create a topic feed",
    ]);
    expect(suggestionsFor(POSITIONS["feed-source"], ["24 hours", "24 hours"])).toEqual([
      "24 hours",
      "Create a topic feed",
      "Use starred repositories",
    ]);
  });

  it("de-duplicates by exact, case-sensitive match only", () => {
    expect(suggestionsFor(POSITIONS["feed-source"], ["create a topic feed"])).toEqual([
      "create a topic feed",
      "Create a topic feed",
      "Use starred repositories",
    ]);
  });

  it("caps the result at four, dropping catalogue entries before hints", () => {
    expect(suggestionsFor(POSITIONS["feed-settings"], ["Include all of them"])).toEqual([
      "Include all of them",
      "1 hour",
      "6 hours",
      "24 hours",
    ]);
    expect(
      suggestionsFor(POSITIONS["repository-selection"], ["a", "b", "c", "d", "e"]),
    ).toHaveLength(4);
  });

  it("is attached to every response built by responseFor", () => {
    expect(
      responseFor("choose-source", DEFAULT_FEED_DRAFT, "Choose a source.", { ttlSelected: false })
        .suggestions,
    ).toEqual(CATALOGUE["feed-source"]);
    expect(
      responseFor("edit-topics", { ...DEFAULT_FEED_DRAFT, source: "topics" }, "Choose topics.", {
        ttlSelected: false,
        showUi: true,
        hints: ["24 hours"],
      }).suggestions,
    ).toEqual(["24 hours", "Which topics are available?"]);
    expect(
      responseFor("ready", topicsDraft, "Ready.", {
        ttlSelected: true,
        feedUrl: "http://example.test/feed/token",
        showUi: true,
      }).suggestions,
    ).toEqual(["Start over"]);
  });
});

describe("promptFor", () => {
  it.each(DECISIONS)("has a question for %s", (decision) => {
    expect(promptFor(decision).trim()).not.toBe("");
  });
});

describe("cannedDecisionFor", () => {
  const TABLE: ReadonlyArray<[string, AssistantRequiredDecision, ModelDecision]> = [
    [
      "Create a topic feed",
      "feed-source",
      { intent: "create-or-update-feed", draftPatch: { source: "topics" } },
    ],
    [
      "Use starred repositories",
      "feed-source",
      { intent: "create-or-update-feed", draftPatch: { source: "starred" } },
    ],
    ["Which topics are available?", "topic-selection", { intent: "list-topics", draftPatch: {} }],
    [
      "Include all of them",
      "repository-selection",
      { intent: "create-or-update-feed", draftPatch: {}, repoSelectionAction: { kind: "all" } },
    ],
    [
      "Select the first 10",
      "repository-selection",
      {
        intent: "create-or-update-feed",
        draftPatch: {},
        repoSelectionAction: { kind: "first", count: 10 },
      },
    ],
    [
      "Show me the repositories",
      "repository-selection",
      { intent: "list-repositories", draftPatch: {} },
    ],
    ["1 hour", "feed-settings", { intent: "create-or-update-feed", draftPatch: { ttl: 3600 } }],
    ["6 hours", "feed-settings", { intent: "create-or-update-feed", draftPatch: { ttl: 21600 } }],
    ["24 hours", "feed-settings", { intent: "create-or-update-feed", draftPatch: { ttl: 86400 } }],
    ["1 week", "feed-settings", { intent: "create-or-update-feed", draftPatch: { ttl: 604800 } }],
  ];

  it.each(TABLE)("answers %j at %s", (message, decision, expected) => {
    const canned = cannedDecisionFor(message, decision);

    expect(canned).toEqual(expected);
    expect(isModelDecision(canned)).toBe(true);
  });

  it.each(TABLE)("answers %j only at %s", (message, decision) => {
    for (const other of DECISIONS.filter((candidate) => candidate !== decision)) {
      expect(cannedDecisionFor(message, other)).toBeNull();
    }
  });

  it.each(TABLE)(
    "ignores case and surrounding whitespace for %j",
    (message, decision, expected) => {
      expect(cannedDecisionFor(`  ${message.toUpperCase()}\n`, decision)).toEqual(expected);
      expect(cannedDecisionFor(`\t${message.toLowerCase()} `, decision)).toEqual(expected);
    },
  );

  it("requires an exact match", () => {
    expect(cannedDecisionFor("24 hours please", "feed-settings")).toBeNull();
    expect(cannedDecisionFor("Include all of them.", "repository-selection")).toBeNull();
    expect(cannedDecisionFor("", "feed-source")).toBeNull();
  });

  it("has no canned decision for the suggestions handled elsewhere", () => {
    for (const decision of DECISIONS) {
      expect(cannedDecisionFor("Show UI", decision)).toBeNull();
      expect(cannedDecisionFor("Start over", decision)).toBeNull();
    }
  });

  it("covers every catalogue entry that reaches the interpreter seam", () => {
    const handledElsewhere = new Set(["Show UI", "Start over"]);

    for (const decision of DECISIONS) {
      for (const suggestion of CATALOGUE[decision]) {
        if (handledElsewhere.has(suggestion)) {
          continue;
        }

        expect(cannedDecisionFor(suggestion, decision)).not.toBeNull();
      }
    }
  });

  it("returns a copy, so a caller cannot alter the table", () => {
    const first = cannedDecisionFor("Include all of them", "repository-selection");

    if (first?.repoSelectionAction?.kind !== "all") {
      throw new Error("expected the all-repositories action");
    }

    first.draftPatch.ttl = 86400;

    expect(cannedDecisionFor("Include all of them", "repository-selection")).toEqual({
      intent: "create-or-update-feed",
      draftPatch: {},
      repoSelectionAction: { kind: "all" },
    });
  });
});
