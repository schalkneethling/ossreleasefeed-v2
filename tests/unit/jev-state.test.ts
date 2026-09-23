import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_DRAFT } from "../../worker/src/assistant/contracts";
import {
  buildJevState,
  FREQUENCY_LABELS,
  JEV_STATE_VERSION,
  type JevTurn,
} from "../../worker/src/assistant/interpreter/jev/state";
import type { AssistantRequiredDecision } from "../../worker/src/assistant/interpreter/jev/types";
import type { TurnCandidates } from "../../worker/src/assistant/interpreter/jev/candidates";

const REQUIRED_DECISIONS: readonly AssistantRequiredDecision[] = [
  "feed-source",
  "topic-selection",
  "github-username",
  "repository-selection",
  "feed-settings",
  "recovery",
  "complete-feed",
];

const noCandidates: TurnCandidates = {
  topics: [],
  usernames: [],
  repositories: [],
  firstCount: null,
  frequency: null,
};

const turn = (overrides: Partial<JevTurn> = {}): JevTurn => ({
  message: "Create a feed",
  draft: DEFAULT_FEED_DRAFT,
  issues: [],
  ttlSelected: false,
  requiredDecision: "feed-source",
  ...overrides,
});

// Recursively collect every object key in a value, to prove certain internal
// draft fields never leak into the state handed to the model.
const collectKeys = (value: unknown, found: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, found);
    }

    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      collectKeys(nested, found);
    }
  }
};

describe("JEV_STATE_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(JEV_STATE_VERSION)).toBe(true);
    expect(JEV_STATE_VERSION).toBeGreaterThan(0);
  });
});

describe("buildJevState", () => {
  it("hides the default one-hour ttl when it was never selected", () => {
    const state = buildJevState(
      turn({ draft: { ...DEFAULT_FEED_DRAFT, ttl: 3600 }, ttlSelected: false }),
      noCandidates,
    );

    expect(state.feed_so_far.update_frequency).toBeNull();
  });

  it("labels the ttl once it has been selected", () => {
    const state = buildJevState(
      turn({ draft: { ...DEFAULT_FEED_DRAFT, ttl: 21600 }, ttlSelected: true }),
      noCandidates,
    );

    expect(state.feed_so_far.update_frequency).toBe("6 hours");
  });

  it("labels every supported ttl consistently with FREQUENCY_LABELS", () => {
    for (const ttlKey of Object.keys(FREQUENCY_LABELS)) {
      const ttl = Number(ttlKey) as (typeof DEFAULT_FEED_DRAFT)["ttl"];
      const state = buildJevState(
        turn({ draft: { ...DEFAULT_FEED_DRAFT, ttl }, ttlSelected: true }),
        noCandidates,
      );

      expect(state.feed_so_far.update_frequency).toBe(FREQUENCY_LABELS[ttl]);
    }
  });

  it("maps a null feed source", () => {
    const state = buildJevState(
      turn({ draft: { ...DEFAULT_FEED_DRAFT, source: null } }),
      noCandidates,
    );

    expect(state.feed_so_far.feed_type).toBeNull();
  });

  it("maps a topics feed source", () => {
    const state = buildJevState(
      turn({ draft: { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] } }),
      noCandidates,
    );

    expect(state.feed_so_far.feed_type).toBe("GitHub topics");
  });

  it("maps a starred feed source", () => {
    const state = buildJevState(
      turn({
        draft: { ...DEFAULT_FEED_DRAFT, source: "starred", username: "octocat" },
      }),
      noCandidates,
    );

    expect(state.feed_so_far.feed_type).toBe("starred repositories");
  });

  it("maps a null repository selection", () => {
    const state = buildJevState(
      turn({ draft: { ...DEFAULT_FEED_DRAFT, repoSelection: null } }),
      noCandidates,
    );

    expect(state.feed_so_far.repositories).toBeNull();
  });

  it("maps an 'all' repository selection", () => {
    const state = buildJevState(
      turn({ draft: { ...DEFAULT_FEED_DRAFT, repoSelection: { kind: "all" } } }),
      noCandidates,
    );

    expect(state.feed_so_far.repositories).toBe("all starred repositories");
  });

  it("maps a subset repository selection", () => {
    const state = buildJevState(
      turn({
        draft: {
          ...DEFAULT_FEED_DRAFT,
          repoSelection: { kind: "subset", repos: ["octocat/hello-world"] },
        },
      }),
      noCandidates,
    );

    expect(state.feed_so_far.repositories).toEqual(["octocat/hello-world"]);
  });

  it("exposes candidate topics as slugs only, dropping their spans", () => {
    const candidates: TurnCandidates = {
      ...noCandidates,
      topics: [
        { slug: "rust", span: [0, 0] },
        { slug: "go", span: null },
      ],
    };
    const state = buildJevState(turn(), candidates);

    expect(state.candidates.topics).toEqual(["rust", "go"]);
  });

  it("echoes the required decision with a non-empty question for every decision", () => {
    for (const requiredDecision of REQUIRED_DECISIONS) {
      const state = buildJevState(turn({ requiredDecision }), noCandidates);

      expect(state.app_just_asked.decision).toBe(requiredDecision);
      expect(typeof state.app_just_asked.question).toBe("string");
      expect(state.app_just_asked.question.length).toBeGreaterThan(0);
    }
  });

  it("never exposes format, topicOperator, or ttl anywhere in the state", () => {
    const candidates: TurnCandidates = {
      ...noCandidates,
      topics: [{ slug: "rust", span: [0, 0] }],
      usernames: ["octocat"],
    };
    const state = buildJevState(
      turn({
        draft: {
          ...DEFAULT_FEED_DRAFT,
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "subset", repos: ["octocat/hello-world"] },
          ttl: 86400,
        },
        ttlSelected: true,
      }),
      candidates,
    );

    const keys = new Set<string>();

    collectKeys(state, keys);

    expect(keys.has("format")).toBe(false);
    expect(keys.has("topicOperator")).toBe(false);
    expect(keys.has("ttl")).toBe(false);
  });
});
