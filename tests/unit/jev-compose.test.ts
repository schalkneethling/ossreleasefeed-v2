import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_DRAFT, isModelDecision } from "../../worker/src/assistant/contracts";
import {
  ACTION_HINT_FLOOR,
  ACTION_THRESHOLD,
  composeDecision,
  HINT_FLOOR,
  INTENT_CLARIFY_THRESHOLD,
  JevCompositionError,
  STATED_THRESHOLD,
  type ComposedDecision,
} from "../../worker/src/assistant/interpreter/jev/compose";
import {
  namesTopicId,
  NO_USERNAME,
  removesTopicId,
} from "../../worker/src/assistant/interpreter/jev/questions";
import type { JevTurn } from "../../worker/src/assistant/interpreter/jev/state";
import type { TurnCandidates } from "../../worker/src/assistant/interpreter/jev/candidates";
import type {
  AssistantRequiredDecision,
  ChoiceAnswer,
  JevAnswer,
  NoulAnswer,
} from "../../worker/src/assistant/interpreter/jev/types";

// Small helper factories for canned Jev answers, per the task brief.
const noul = (probability: number): NoulAnswer => ({ type: "noul", noul: probability });
const choice = (label: string, confidence: number): ChoiceAnswer => ({
  type: "choice",
  choice: label,
  confidence,
  probabilities: {},
});

// Every composed decision must also satisfy the wire contract.
const expectValidDecision = (result: ComposedDecision): void => {
  expect(isModelDecision(result.decision)).toBe(true);
};

const baseCandidates: TurnCandidates = {
  topics: [],
  usernames: [],
  repositories: [],
  firstCount: null,
  frequency: null,
};

const baseTurn: JevTurn = {
  message: "test message",
  draft: DEFAULT_FEED_DRAFT,
  issues: [],
  ttlSelected: false,
  requiredDecision: "feed-source",
};

describe("composeDecision - read-only intents", () => {
  it("yields an empty draftPatch and no repoSelectionAction even with high field signals", () => {
    const candidates: TurnCandidates = {
      ...baseCandidates,
      topics: [{ slug: "rust", span: [0, 0] }],
      usernames: ["octocat"],
      repositories: ["octocat/hello-world"],
      firstCount: 5,
    };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("list-topics", 0.95),
      source_stated: noul(0.99),
      source_value: choice("starred", 0.99),
      [namesTopicId(0)]: noul(0.99),
      username_stated: noul(0.9),
      username: choice("octocat", 0.99),
      wants_all_starred: noul(0.99),
      asks_first_n: noul(0.99),
      activity_stated: noul(0.99),
      activity_value: choice("all", 0.99),
      frequency_stated: noul(0.99),
      frequency_value: choice("24 hours", 0.99),
    });

    expect(result.decision).toEqual({ intent: "list-topics", draftPatch: {} });
    expect(result.decision).not.toHaveProperty("repoSelectionAction");
    expectValidDecision(result);
  });

  it("returns the same read-only intent for every ordinary informational choice", () => {
    for (const intent of [
      "explain-capabilities",
      "list-topics",
      "list-repositories",
      "list-settings",
      "show-ui",
      "hide-ui",
    ] as const) {
      const result = composeDecision(baseTurn, baseCandidates, {
        intent: choice(intent, 0.8),
      });

      expect(result.decision).toEqual({ intent, draftPatch: {} });
      expectValidDecision(result);
    }
  });
});

describe("composeDecision - generic-options", () => {
  const expected: Record<AssistantRequiredDecision, string> = {
    "feed-source": "explain-capabilities",
    "topic-selection": "list-topics",
    "github-username": "explain-capabilities",
    "repository-selection": "list-repositories",
    "feed-settings": "list-settings",
    recovery: "explain-capabilities",
    "complete-feed": "explain-capabilities",
  };

  for (const [requiredDecision, mappedIntent] of Object.entries(expected) as Array<
    [AssistantRequiredDecision, string]
  >) {
    it(`maps ${requiredDecision} to ${mappedIntent}`, () => {
      const result = composeDecision({ ...baseTurn, requiredDecision }, baseCandidates, {
        intent: choice("generic-options", 0.9),
      });

      expect(result.decision.intent).toBe(mappedIntent);
      expect(result.decision.draftPatch).toEqual({});
      expectValidDecision(result);
    });
  }
});

describe("composeDecision - unsupported", () => {
  it("reports unsupportedReason 'request' with an empty patch", () => {
    const result = composeDecision(baseTurn, baseCandidates, {
      intent: choice("unsupported", 0.9),
    });

    expect(result.decision).toEqual({
      intent: "unsupported",
      draftPatch: {},
      unsupportedReason: "request",
    });
    expectValidDecision(result);
  });

  it("reports unsupportedReason 'interval' when a stated frequency parses as unsupported", () => {
    const result = composeDecision(
      baseTurn,
      { ...baseCandidates, frequency: { kind: "unsupported" } },
      {
        intent: choice("create-or-update-feed", 0.9),
        frequency_stated: noul(0.9),
      },
    );

    expect(result.decision.intent).toBe("unsupported");
    expect(result.decision.unsupportedReason).toBe("interval");
    expect(result.decision.draftPatch).toEqual({});
    expectValidDecision(result);
  });

  it("reports unsupportedReason 'interval' when the model's frequency_value has no matching ttl", () => {
    const result = composeDecision(baseTurn, baseCandidates, {
      intent: choice("create-or-update-feed", 0.9),
      frequency_stated: noul(0.9),
      frequency_value: choice("other", 0.9),
    });

    expect(result.decision.intent).toBe("unsupported");
    expect(result.decision.unsupportedReason).toBe("interval");
    expectValidDecision(result);
  });
});

describe("composeDecision - frequency", () => {
  it("prefers a code-parsed supported duration over a conflicting frequency_value choice", () => {
    const result = composeDecision(
      baseTurn,
      { ...baseCandidates, frequency: { kind: "supported", ttl: 21600 } },
      {
        intent: choice("create-or-update-feed", 0.9),
        frequency_stated: noul(0.9),
        frequency_value: choice("24 hours", 0.95),
      },
    );

    expect(result.decision.draftPatch.ttl).toBe(21600);
    expectValidDecision(result);
  });

  it("uses frequency_value when nothing was parsed from the message", () => {
    const result = composeDecision(baseTurn, baseCandidates, {
      intent: choice("create-or-update-feed", 0.9),
      frequency_stated: noul(0.9),
      frequency_value: choice("1 hour", 0.95),
    });

    expect(result.decision.draftPatch.ttl).toBe(3600);
    expectValidDecision(result);
  });

  it("ignores a parsed frequency when frequency_stated is below the threshold", () => {
    const result = composeDecision(
      baseTurn,
      { ...baseCandidates, frequency: { kind: "supported", ttl: 21600 } },
      {
        intent: choice("create-or-update-feed", 0.9),
        frequency_stated: noul(0.3),
      },
    );

    expect(result.decision.draftPatch.ttl).toBeUndefined();
    expectValidDecision(result);
  });
});

describe("composeDecision - topics", () => {
  it("implies source 'topics' when a topic is named from a null source", () => {
    const candidates: TurnCandidates = {
      ...baseCandidates,
      topics: [{ slug: "css", span: [0, 0] }],
    };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      [namesTopicId(0)]: noul(0.9),
    });

    expect(result.decision.draftPatch.source).toBe("topics");
    expect(result.decision.draftPatch.topics).toEqual(["css"]);
    expectValidDecision(result);
  });

  it("lets the longest named n-gram win over its named sub-words", () => {
    const candidates: TurnCandidates = {
      ...baseCandidates,
      topics: [
        { slug: "machine", span: [0, 0] },
        { slug: "machine-learning", span: [0, 1] },
        { slug: "learning", span: [1, 1] },
      ],
    };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      [namesTopicId(0)]: noul(0.9),
      [namesTopicId(1)]: noul(0.9),
      [namesTopicId(2)]: noul(0.9),
    });

    expect(result.decision.draftPatch.topics).toEqual(["machine-learning"]);
    expectValidDecision(result);
  });

  it("adds a named topic to the existing list by default (add_to_list)", () => {
    const draft = { ...DEFAULT_FEED_DRAFT, source: "topics" as const, topics: ["python"] };
    const candidates: TurnCandidates = {
      ...baseCandidates,
      topics: [{ slug: "rust", span: [0, 0] }],
    };
    const result = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      [namesTopicId(0)]: noul(0.9),
    });

    expect(result.decision.draftPatch.topics).toEqual(["python", "rust"]);
    expectValidDecision(result);
  });

  it("replaces the existing list when topic_edit_mode says replace_list", () => {
    const draft = { ...DEFAULT_FEED_DRAFT, source: "topics" as const, topics: ["python"] };
    const candidates: TurnCandidates = {
      ...baseCandidates,
      topics: [{ slug: "rust", span: [0, 0] }],
    };
    const result = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      [namesTopicId(0)]: noul(0.9),
      topic_edit_mode: choice("replace_list", 0.9),
    });

    expect(result.decision.draftPatch.topics).toEqual(["rust"]);
    expectValidDecision(result);
  });

  it("drops a removed existing topic without touching source", () => {
    const draft = {
      ...DEFAULT_FEED_DRAFT,
      source: "topics" as const,
      topics: ["python", "css"],
    };
    const result = composeDecision({ ...baseTurn, draft }, baseCandidates, {
      intent: choice("create-or-update-feed", 0.9),
      [removesTopicId(0)]: noul(0.9),
    });

    expect(result.decision.draftPatch.topics).toEqual(["css"]);
    expect(result.decision.draftPatch.source).toBeUndefined();
    expectValidDecision(result);
  });
});

describe("composeDecision - username / starred source", () => {
  it("consumes a valid, confident, candidate username and implies source starred", () => {
    const candidates: TurnCandidates = { ...baseCandidates, usernames: ["octocat"] };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.9),
      username: choice("octocat", 0.9),
    });

    expect(result.decision.draftPatch.username).toBe("octocat");
    expect(result.decision.draftPatch.source).toBe("starred");
    expectValidDecision(result);
  });

  it("ignores the NO_USERNAME choice", () => {
    const candidates: TurnCandidates = { ...baseCandidates, usernames: ["octocat"] };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.9),
      username: choice(NO_USERNAME, 0.9),
    });

    expect(result.decision.draftPatch.username).toBeUndefined();
    expect(result.decision.draftPatch.source).toBeUndefined();
    expectValidDecision(result);
  });

  it("ignores a low-confidence username choice", () => {
    const candidates: TurnCandidates = { ...baseCandidates, usernames: ["octocat"] };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.9),
      username: choice("octocat", 0.2),
    });

    expect(result.decision.draftPatch.username).toBeUndefined();
    expectValidDecision(result);
  });

  it("ignores a username choice that is not among the candidates", () => {
    const candidates: TurnCandidates = { ...baseCandidates, usernames: ["octocat"] };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.9),
      username: choice("ghost", 0.9),
    });

    expect(result.decision.draftPatch.username).toBeUndefined();
    expectValidDecision(result);
  });
});

describe("composeDecision - repository selection", () => {
  it("turns explicit owner/repo names into a subset and implies source starred", () => {
    const candidates: TurnCandidates = {
      ...baseCandidates,
      repositories: ["octocat/hello-world"],
    };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.9),
    });

    expect(result.decision.draftPatch.source).toBe("starred");
    expect(result.decision.draftPatch.repoSelection).toEqual({
      kind: "subset",
      repos: ["octocat/hello-world"],
    });
    expect(result.decision).not.toHaveProperty("repoSelectionAction");
    expectValidDecision(result);
  });

  it("only replaces when the draft already has a subset AND replaces_selection is high", () => {
    const draft = {
      ...DEFAULT_FEED_DRAFT,
      source: "starred" as const,
      username: "octocat",
      repoSelection: { kind: "subset" as const, repos: ["old/repo"] },
    };
    const candidates: TurnCandidates = { ...baseCandidates, repositories: ["new/repo"] };

    const replaced = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      replaces_selection: noul(0.9),
    });

    expect(replaced.decision.repoSelectionAction).toEqual({ kind: "replace" });
    expectValidDecision(replaced);

    const notReplaced = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      replaces_selection: noul(0.2),
    });

    expect(notReplaced.decision).not.toHaveProperty("repoSelectionAction");
    expectValidDecision(notReplaced);
  });

  it("does not replace when the existing selection is 'all' rather than a subset", () => {
    const draft = {
      ...DEFAULT_FEED_DRAFT,
      source: "starred" as const,
      username: "octocat",
      repoSelection: { kind: "all" as const },
    };
    const candidates: TurnCandidates = { ...baseCandidates, repositories: ["new/repo"] };
    const result = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      replaces_selection: noul(0.9),
    });

    expect(result.decision).not.toHaveProperty("repoSelectionAction");
    expectValidDecision(result);
  });

  it("needs both asks_first_n and a parsed firstCount to select the first N", () => {
    const draft = { ...DEFAULT_FEED_DRAFT, source: "starred" as const, username: "octocat" };
    const withCount: TurnCandidates = {
      ...baseCandidates,
      usernames: ["octocat"],
      firstCount: 10,
    };
    const withCountResult = composeDecision({ ...baseTurn, draft }, withCount, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.9),
      username: choice("octocat", 0.9),
      asks_first_n: noul(0.9),
    });

    expect(withCountResult.decision.repoSelectionAction).toEqual({ kind: "first", count: 10 });
    expectValidDecision(withCountResult);

    const withoutCount: TurnCandidates = {
      ...baseCandidates,
      usernames: ["octocat"],
      firstCount: null,
    };
    const withoutCountResult = composeDecision({ ...baseTurn, draft }, withoutCount, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.9),
      username: choice("octocat", 0.9),
      asks_first_n: noul(0.9),
    });

    expect(withoutCountResult.decision).not.toHaveProperty("repoSelectionAction");
    expectValidDecision(withoutCountResult);
  });

  it("selects all starred repositories when wants_all_starred is high", () => {
    const draft = { ...DEFAULT_FEED_DRAFT, source: "starred" as const, username: "octocat" };
    const candidates: TurnCandidates = { ...baseCandidates, usernames: ["octocat"] };
    const result = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.9),
      username: choice("octocat", 0.9),
      wants_all_starred: noul(0.9),
    });

    expect(result.decision.repoSelectionAction).toEqual({ kind: "all" });
    expectValidDecision(result);
  });

  it("never selects all repositories when the message refers back to an existing selection", () => {
    const draft = {
      ...DEFAULT_FEED_DRAFT,
      source: "starred" as const,
      username: "octocat",
      repoSelection: { kind: "subset" as const, repos: ["example/one", "example/two"] },
    };
    const result = composeDecision({ ...baseTurn, draft }, baseCandidates, {
      intent: choice("create-or-update-feed", 0.9),
      wants_all_starred: noul(0.9),
      refers_to_existing_selection: noul(0.9),
    });

    expect(result.decision).toEqual({ intent: "create-or-update-feed", draftPatch: {} });
    expectValidDecision(result);
  });
});

describe("composeDecision - injection", () => {
  it("discards the whole message, valid fields included, on an injection attempt", () => {
    const result = composeDecision(
      baseTurn,
      { ...baseCandidates, frequency: { kind: "supported", ttl: 86400 } },
      {
        intent: choice("create-or-update-feed", 0.9),
        frequency_stated: noul(0.95),
        injection_attempt: noul(0.9),
      },
    );

    expect(result.decision).toEqual({
      intent: "unsupported",
      draftPatch: {},
      unsupportedReason: "request",
    });
    expectValidDecision(result);
  });

  it("does not discard an informational turn below the injection threshold", () => {
    const result = composeDecision(baseTurn, baseCandidates, {
      intent: choice("list-topics", 0.9),
      injection_attempt: noul(0.4),
    });

    expect(result.decision).toEqual({ intent: "list-topics", draftPatch: {} });
    expectValidDecision(result);
  });
});

describe("composeDecision - topic substitution", () => {
  it("keeps the topics that were not removed even when edit mode reads as replace", () => {
    const draft = { ...DEFAULT_FEED_DRAFT, source: "topics" as const, topics: ["go", "elixir"] };
    const candidates: TurnCandidates = {
      ...baseCandidates,
      topics: [
        { slug: "elixir", span: [1, 1] },
        { slug: "gleam", span: [3, 3] },
      ],
    };
    const result = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      [namesTopicId(1)]: noul(0.9),
      [removesTopicId(1)]: noul(0.9),
      topic_edit_mode: choice("replace_list", 0.8),
    });

    expect(result.decision.draftPatch.topics).toEqual(["go", "gleam"]);
    expectValidDecision(result);
  });
});

describe("composeDecision - username gate", () => {
  it("ignores a confident username choice when no username was stated", () => {
    const draft = { ...DEFAULT_FEED_DRAFT, source: "starred" as const, username: "octocat" };
    const candidates: TurnCandidates = { ...baseCandidates, usernames: ["only"] };
    const result = composeDecision({ ...baseTurn, draft }, candidates, {
      intent: choice("create-or-update-feed", 0.9),
      username_stated: noul(0.1),
      username: choice("only", 0.9),
    });

    expect(result.decision.draftPatch).toEqual({});
    expectValidDecision(result);
  });
});

describe("composeDecision - errors", () => {
  it("throws JevCompositionError when the intent answer is missing", () => {
    expect(() => composeDecision(baseTurn, baseCandidates, {})).toThrow(JevCompositionError);
  });

  it("throws JevCompositionError for an unrecognized intent choice", () => {
    const answers: Record<string, JevAnswer> = { intent: choice("not-a-real-intent", 0.9) };

    expect(() => composeDecision(baseTurn, baseCandidates, answers)).toThrow(JevCompositionError);
  });
});

describe("composeDecision - confidence", () => {
  it("equals the minimum of every consumed judgment", () => {
    const candidates: TurnCandidates = {
      ...baseCandidates,
      topics: [{ slug: "css", span: [0, 0] }],
    };
    const result = composeDecision(baseTurn, candidates, {
      intent: choice("create-or-update-feed", 0.95),
      [namesTopicId(0)]: noul(0.72),
    });

    expect(result.confidence).toBe(0.72);
    expectValidDecision(result);
  });

  it("falls back to the intent confidence alone for a read-only turn", () => {
    const result = composeDecision(baseTurn, baseCandidates, {
      intent: choice("list-topics", 0.61),
    });

    expect(result.confidence).toBe(0.61);
    expectValidDecision(result);
  });
});

describe("composeDecision - hints", () => {
  const starredTurn: JevTurn = {
    ...baseTurn,
    draft: { ...DEFAULT_FEED_DRAFT, source: "starred", username: "octocat" },
    requiredDecision: "repository-selection",
  };
  const topicsTurn: JevTurn = {
    ...baseTurn,
    draft: { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
    requiredDecision: "feed-settings",
  };
  const mutating = choice("create-or-update-feed", 0.9);

  it("names the bands it uses", () => {
    expect(HINT_FLOOR).toBe(0.3);
    expect(ACTION_HINT_FLOOR).toBe(0.4);
    expect(INTENT_CLARIFY_THRESHOLD).toBe(0.4);
    expect(HINT_FLOOR).toBeLessThan(STATED_THRESHOLD);
    expect(ACTION_HINT_FLOOR).toBeLessThan(ACTION_THRESHOLD);
  });

  it("has no hints when nothing was half-heard", () => {
    const result = composeDecision(starredTurn, baseCandidates, { intent: mutating });

    expect(result.hints).toEqual([]);
    expectValidDecision(result);
  });

  describe("wants_all_starred", () => {
    it.each([0.4, 0.55, 0.69])("hints at %f, inside the band", (probability) => {
      const result = composeDecision(starredTurn, baseCandidates, {
        intent: mutating,
        wants_all_starred: noul(probability),
      });

      expect(result.hints).toEqual(["Include all of them"]);
      expect(result.decision.repoSelectionAction).toBeUndefined();
      expectValidDecision(result);
    });

    it("does not hint below the floor", () => {
      const result = composeDecision(starredTurn, baseCandidates, {
        intent: mutating,
        wants_all_starred: noul(0.39),
      });

      expect(result.hints).toEqual([]);
    });

    it("does not hint when the action was applied", () => {
      const result = composeDecision(starredTurn, baseCandidates, {
        intent: mutating,
        wants_all_starred: noul(0.7),
      });

      expect(result.decision.repoSelectionAction).toEqual({ kind: "all" });
      expect(result.hints).toEqual([]);
    });

    it("does not hint when the resulting source is not starred", () => {
      const result = composeDecision(topicsTurn, baseCandidates, {
        intent: mutating,
        wants_all_starred: noul(0.6),
      });

      expect(result.hints).toEqual([]);
    });

    it("hints when the message itself makes the source starred", () => {
      const result = composeDecision(
        baseTurn,
        { ...baseCandidates, usernames: ["octocat"] },
        {
          intent: mutating,
          username_stated: noul(0.9),
          username: choice("octocat", 0.9),
          wants_all_starred: noul(0.6),
        },
      );

      expect(result.decision.draftPatch).toEqual({ source: "starred", username: "octocat" });
      expect(result.hints).toEqual(["Include all of them"]);
    });

    it("does not hint when repositories were named", () => {
      const result = composeDecision(
        starredTurn,
        { ...baseCandidates, repositories: ["octocat/hello-world"] },
        { intent: mutating, wants_all_starred: noul(0.6) },
      );

      expect(result.hints).toEqual([]);
    });

    it("does not hint when a first-N action was applied", () => {
      const result = composeDecision(
        starredTurn,
        { ...baseCandidates, firstCount: 5 },
        { intent: mutating, asks_first_n: noul(0.9), wants_all_starred: noul(0.6) },
      );

      expect(result.decision.repoSelectionAction).toEqual({ kind: "first", count: 5 });
      expect(result.hints).toEqual([]);
    });

    it("does not hint when the message refers back to an existing selection", () => {
      const result = composeDecision(starredTurn, baseCandidates, {
        intent: mutating,
        refers_to_existing_selection: noul(0.9),
        wants_all_starred: noul(0.6),
      });

      expect(result.hints).toEqual([]);
    });
  });

  describe("frequency_stated", () => {
    it.each([0.3, 0.4, 0.49])("hints the code-parsed value at %f", (probability) => {
      const result = composeDecision(
        topicsTurn,
        { ...baseCandidates, frequency: { kind: "supported", ttl: 86400 } },
        // The model's own reading loses to the duration parsed in code.
        {
          intent: mutating,
          frequency_stated: noul(probability),
          frequency_value: choice("1 hour", 0.9),
        },
      );

      expect(result.hints).toEqual(["24 hours"]);
      expect(result.decision.draftPatch).toEqual({});
      expectValidDecision(result);
    });

    it.each([
      ["1 hour", "1 hour"],
      ["6 hours", "6 hours"],
      ["24 hours", "24 hours"],
      ["1 week", "1 week"],
    ])("hints the model's confident %s choice when nothing was parsed", (label, hint) => {
      const result = composeDecision(topicsTurn, baseCandidates, {
        intent: mutating,
        frequency_stated: noul(0.4),
        frequency_value: choice(label, 0.5),
      });

      expect(result.hints).toEqual([hint]);
    });

    it("does not hint outside the band", () => {
      const candidates: TurnCandidates = {
        ...baseCandidates,
        frequency: { kind: "supported", ttl: 86400 },
      };
      const below = composeDecision(topicsTurn, candidates, {
        intent: mutating,
        frequency_stated: noul(0.29),
      });
      const applied = composeDecision(topicsTurn, candidates, {
        intent: mutating,
        frequency_stated: noul(0.5),
      });

      expect(below.hints).toEqual([]);
      expect(applied.decision.draftPatch).toEqual({ ttl: 86400 });
      expect(applied.hints).toEqual([]);
    });

    it("does not hint an unsure or unsupported choice", () => {
      const unsure = composeDecision(topicsTurn, baseCandidates, {
        intent: mutating,
        frequency_stated: noul(0.4),
        frequency_value: choice("24 hours", 0.49),
      });
      const unsupported = composeDecision(topicsTurn, baseCandidates, {
        intent: mutating,
        frequency_stated: noul(0.4),
        frequency_value: choice("some other interval", 0.9),
      });

      expect(unsure.hints).toEqual([]);
      expect(unsupported.hints).toEqual([]);
    });

    it("does not hint the model's choice when code parsed an unsupported duration", () => {
      const result = composeDecision(
        topicsTurn,
        { ...baseCandidates, frequency: { kind: "unsupported" } },
        { intent: mutating, frequency_stated: noul(0.4), frequency_value: choice("1 hour", 0.9) },
      );

      expect(result.hints).toEqual([]);
    });
  });

  describe("source_stated", () => {
    it.each([
      ["topics", "Create a topic feed"],
      ["starred", "Use starred repositories"],
    ])("hints a half-heard %s source", (source, hint) => {
      for (const probability of [0.3, 0.49]) {
        const result = composeDecision(baseTurn, baseCandidates, {
          intent: mutating,
          source_stated: noul(probability),
          source_value: choice(source, 0.5),
        });

        expect(result.hints).toEqual([hint]);
        expect(result.decision.draftPatch).toEqual({});
        expectValidDecision(result);
      }
    });

    it("does not hint outside the band", () => {
      const below = composeDecision(baseTurn, baseCandidates, {
        intent: mutating,
        source_stated: noul(0.29),
        source_value: choice("topics", 0.9),
      });
      const applied = composeDecision(baseTurn, baseCandidates, {
        intent: mutating,
        source_stated: noul(0.5),
        source_value: choice("topics", 0.9),
      });

      expect(below.hints).toEqual([]);
      expect(applied.decision.draftPatch).toEqual({ source: "topics" });
      expect(applied.hints).toEqual([]);
    });

    it("does not hint an unsure source choice", () => {
      const result = composeDecision(baseTurn, baseCandidates, {
        intent: mutating,
        source_stated: noul(0.4),
        source_value: choice("topics", 0.49),
      });

      expect(result.hints).toEqual([]);
    });

    it("does not hint the source the draft already has", () => {
      const result = composeDecision(topicsTurn, baseCandidates, {
        intent: mutating,
        source_stated: noul(0.4),
        source_value: choice("topics", 0.9),
      });

      expect(result.hints).toEqual([]);
    });

    it("does not hint a source the message already implied", () => {
      const result = composeDecision(
        baseTurn,
        { ...baseCandidates, topics: [{ slug: "rust", span: [0, 0] }] },
        {
          intent: mutating,
          [namesTopicId(0)]: noul(0.9),
          source_stated: noul(0.4),
          source_value: choice("topics", 0.9),
        },
      );

      expect(result.decision.draftPatch).toEqual({ source: "topics", topics: ["rust"] });
      expect(result.hints).toEqual([]);
    });
  });

  it("orders several hints source, repositories, frequency", () => {
    const result = composeDecision(
      { ...starredTurn, draft: { ...starredTurn.draft } },
      { ...baseCandidates, frequency: { kind: "supported", ttl: 604800 } },
      {
        intent: mutating,
        source_stated: noul(0.4),
        source_value: choice("topics", 0.9),
        wants_all_starred: noul(0.6),
        frequency_stated: noul(0.4),
      },
    );

    expect(result.hints).toEqual(["Create a topic feed", "Include all of them", "1 week"]);
  });

  const halfHeard: Record<string, JevAnswer> = {
    source_stated: noul(0.4),
    source_value: choice("topics", 0.9),
    wants_all_starred: noul(0.6),
    frequency_stated: noul(0.4),
    frequency_value: choice("24 hours", 0.9),
  };

  it.each([
    "explain-capabilities",
    "list-topics",
    "list-repositories",
    "list-settings",
    "show-ui",
    "hide-ui",
    "unsupported",
  ])("never hints for a %s result", (intent) => {
    const result = composeDecision(starredTurn, baseCandidates, {
      ...halfHeard,
      intent: choice(intent, 0.9),
    });

    expect(result.hints).toEqual([]);
    expectValidDecision(result);
  });

  it("never hints for an unsupported interval", () => {
    const result = composeDecision(
      starredTurn,
      { ...baseCandidates, frequency: { kind: "unsupported" } },
      { ...halfHeard, intent: mutating, frequency_stated: noul(0.9) },
    );

    expect(result.decision.unsupportedReason).toBe("interval");
    expect(result.hints).toEqual([]);
  });

  it("never hints for an injection discard", () => {
    const result = composeDecision(starredTurn, baseCandidates, {
      ...halfHeard,
      intent: mutating,
      injection_attempt: noul(0.9),
    });

    expect(result.decision).toEqual({
      intent: "unsupported",
      draftPatch: {},
      unsupportedReason: "request",
    });
    expect(result.hints).toEqual([]);
  });

  it("leaves the decision untouched by the half-heard signals", () => {
    const withSignals = composeDecision(starredTurn, baseCandidates, {
      ...halfHeard,
      intent: mutating,
    });
    const without = composeDecision(starredTurn, baseCandidates, { intent: mutating });

    expect(withSignals.decision).toEqual(without.decision);
  });
});

describe("composeDecision - intent confidence", () => {
  it("reports the intent answer's confidence apart from the minimum", () => {
    const result = composeDecision(
      baseTurn,
      { ...baseCandidates, topics: [{ slug: "css", span: [0, 0] }] },
      { intent: choice("create-or-update-feed", 0.95), [namesTopicId(0)]: noul(0.72) },
    );

    expect(result.intentConfidence).toBe(0.95);
    expect(result.confidence).toBe(0.72);
  });

  it.each(["list-topics", "unsupported"])("reports it for a %s result", (intent) => {
    expect(
      composeDecision(baseTurn, baseCandidates, { intent: choice(intent, 0.37) }).intentConfidence,
    ).toBe(0.37);
  });

  it("reports it for an injection discard", () => {
    const result = composeDecision(baseTurn, baseCandidates, {
      intent: choice("create-or-update-feed", 0.35),
      injection_attempt: noul(0.95),
    });

    expect(result.intentConfidence).toBe(0.35);
  });
});
