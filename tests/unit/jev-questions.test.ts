import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_DRAFT, type FeedDraft } from "../../worker/src/assistant/contracts";
import {
  buildJevQuestions,
  GENERIC_OPTIONS_INTENT,
  namesTopicId,
  NO_USERNAME,
  removesTopicId,
} from "../../worker/src/assistant/interpreter/jev/questions";
import type { TurnCandidates } from "../../worker/src/assistant/interpreter/jev/candidates";

const STATIC_IDS = [
  "intent",
  "source_stated",
  "source_value",
  "frequency_stated",
  "frequency_value",
  "activity_stated",
  "activity_value",
  "wants_all_starred",
  "refers_to_existing_selection",
  "replaces_selection",
  "asks_first_n",
  "asks_for_information",
  "about_ui_visibility",
  "out_of_scope",
];

const noCandidates: TurnCandidates = {
  topics: [],
  usernames: [],
  repositories: [],
  firstCount: null,
  frequency: null,
};

describe("GENERIC_OPTIONS_INTENT and NO_USERNAME", () => {
  it("are non-empty, stable string identifiers", () => {
    expect(typeof GENERIC_OPTIONS_INTENT).toBe("string");
    expect(GENERIC_OPTIONS_INTENT.length).toBeGreaterThan(0);
    expect(typeof NO_USERNAME).toBe("string");
    expect(NO_USERNAME.length).toBeGreaterThan(0);
  });
});

describe("buildJevQuestions", () => {
  it("always includes every static question id", () => {
    const questions = buildJevQuestions(DEFAULT_FEED_DRAFT, noCandidates);

    for (const id of STATIC_IDS) {
      expect(questions).toHaveProperty(id);
    }
  });

  it("omits the username question when there are no username candidates", () => {
    const questions = buildJevQuestions(DEFAULT_FEED_DRAFT, noCandidates);

    expect(questions.username).toBeUndefined();
  });

  it("adds a username question with NO_USERNAME plus each candidate as a criteria key", () => {
    const candidates: TurnCandidates = { ...noCandidates, usernames: ["octocat", "hubot"] };
    const questions = buildJevQuestions(DEFAULT_FEED_DRAFT, candidates);

    expect(questions.username?.type).toBe("choice");

    if (questions.username?.type !== "choice") {
      throw new Error("expected a choice question");
    }

    expect(Object.keys(questions.username.criteria)).toEqual(["octocat", "hubot", NO_USERNAME]);
  });

  it("adds one names_topic_<i> per topic candidate that has a span", () => {
    const candidates: TurnCandidates = {
      ...noCandidates,
      topics: [
        { slug: "rust", span: [0, 0] },
        { slug: "go", span: null },
        { slug: "css", span: [2, 2] },
      ],
    };
    const questions = buildJevQuestions(DEFAULT_FEED_DRAFT, candidates);

    expect(questions[namesTopicId(0)]).toBeDefined();
    expect(questions[namesTopicId(1)]).toBeUndefined();
    expect(questions[namesTopicId(2)]).toBeDefined();
    expect(questions[namesTopicId(0)]?.type).toBe("noul");
  });

  it("aligns the names_topic index to the candidates.topics array position", () => {
    const candidates: TurnCandidates = {
      ...noCandidates,
      topics: [
        { slug: "go", span: null },
        { slug: "rust", span: [1, 1] },
      ],
    };
    const questions = buildJevQuestions(DEFAULT_FEED_DRAFT, candidates);

    expect(questions[namesTopicId(0)]).toBeUndefined();
    expect(questions[namesTopicId(1)]).toBeDefined();

    if (questions[namesTopicId(1)]?.type !== "noul") {
      throw new Error("expected a noul question");
    }

    expect(JSON.stringify(questions[namesTopicId(1)])).toContain("rust");
  });

  it("adds one removes_topic_<i> per existing draft topic", () => {
    const draft: FeedDraft = { ...DEFAULT_FEED_DRAFT, topics: ["python", "css"] };
    const questions = buildJevQuestions(draft, noCandidates);

    expect(questions[removesTopicId(0)]?.type).toBe("noul");
    expect(questions[removesTopicId(1)]?.type).toBe("noul");
    expect(questions[removesTopicId(2)]).toBeUndefined();
  });

  it("omits topic_edit_mode when the draft has no topics", () => {
    const questions = buildJevQuestions(DEFAULT_FEED_DRAFT, noCandidates);

    expect(questions.topic_edit_mode).toBeUndefined();
  });

  it("adds topic_edit_mode when the draft already has topics", () => {
    const draft: FeedDraft = { ...DEFAULT_FEED_DRAFT, topics: ["python"] };
    const questions = buildJevQuestions(draft, noCandidates);

    expect(questions.topic_edit_mode?.type).toBe("choice");
  });

  it("gives every question a valid type and complete noul criteria", () => {
    const draft: FeedDraft = { ...DEFAULT_FEED_DRAFT, topics: ["python", "css"] };
    const candidates: TurnCandidates = {
      ...noCandidates,
      usernames: ["octocat"],
      topics: [
        { slug: "rust", span: [0, 0] },
        { slug: "go", span: null },
      ],
    };
    const questions = buildJevQuestions(draft, candidates);
    const values = Object.values(questions);

    expect(values.length).toBeGreaterThan(0);

    for (const question of values) {
      expect(["noul", "choice"]).toContain(question.type);
    }

    const noulQuestions = values.filter((question) => question.type === "noul");

    expect(noulQuestions.length).toBeGreaterThan(0);

    for (const question of noulQuestions) {
      expect(question.criteria.true).toBeTruthy();
      expect(question.criteria.false).toBeTruthy();
    }
  });
});
