import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_DRAFT,
  isAssistantTurnRequest,
  isModelDecision,
} from "../../worker/src/assistant/contracts";
import { applyDraftPatch, isLegalTransition } from "../../worker/src/assistant/state";

const validRequest = {
  message: "Create a CSS feed",
  state: "idle",
  draft: DEFAULT_FEED_DRAFT,
  issues: [],
  ttlSelected: false,
};

describe("assistant contracts", () => {
  it("accepts the current request contract", () => {
    expect(
      isAssistantTurnRequest({
        ...validRequest,
      }),
    ).toBe(true);
  });

  it("rejects overlong messages and unknown fields", () => {
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        message: "x".repeat(1001),
      }),
    ).toBe(false);
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        extra: true,
      }),
    ).toBe(false);
  });

  it("rejects transcript history on the stateless turn contract", () => {
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        history: [{ role: "user", content: "Create a feed" }],
      }),
    ).toBe(false);
  });

  it("accepts a request at the message boundary", () => {
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        message: "x".repeat(1_000),
      }),
    ).toBe(true);
  });

  it("rejects an empty request message", () => {
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        message: "",
      }),
    ).toBe(false);
  });

  it("rejects model URLs and unknown model fields", () => {
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: { source: "topics", topics: ["css"] },
        feedUrl: "https://malicious.example/feed",
      }),
    ).toBe(false);
  });

  it("accepts a valid model decision without a feed URL", () => {
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: { source: "topics", topics: [] },
      }),
    ).toBe(true);
  });

  it("accepts hide UI as a read-only model decision", () => {
    expect(
      isModelDecision({
        intent: "hide-ui",
        draftPatch: {},
      }),
    ).toBe(true);
  });

  it("validates positional repository-selection actions", () => {
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: {},
        repoSelectionAction: { kind: "all" },
      }),
    ).toBe(true);
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: {},
        repoSelectionAction: { kind: "first", count: 10 },
      }),
    ).toBe(true);
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: {},
        repoSelectionAction: { kind: "first", count: 0 },
      }),
    ).toBe(false);
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: {},
        repoSelectionAction: { kind: "first", count: 26 },
      }),
    ).toBe(false);
  });

  it("requires a categorical reason only for unsupported decisions", () => {
    expect(
      isModelDecision({
        intent: "unsupported",
        draftPatch: {},
        unsupportedReason: "request",
      }),
    ).toBe(true);
    expect(isModelDecision({ intent: "unsupported", draftPatch: {} })).toBe(false);
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: {},
        unsupportedReason: "request",
      }),
    ).toBe(false);
  });

  it("rejects model attempts to clear the source with a neutral null", () => {
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: { source: null },
      }),
    ).toBe(false);
  });

  it("infers a source from explicit branch fields and clears stale repository selections", () => {
    expect(
      applyDraftPatch(
        {
          ...DEFAULT_FEED_DRAFT,
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "all" },
        },
        { topics: ["CSS"] },
      ),
    ).toMatchObject({ source: "topics", topics: ["css"], username: null, repoSelection: null });

    expect(
      applyDraftPatch(
        {
          ...DEFAULT_FEED_DRAFT,
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "all" },
        },
        { username: "github" },
      ),
    ).toMatchObject({ source: "starred", username: "github", repoSelection: null });
  });

  it("preserves a pending named repository subset when the first username arrives", () => {
    expect(
      applyDraftPatch(
        {
          ...DEFAULT_FEED_DRAFT,
          source: "starred",
          repoSelection: {
            kind: "subset",
            repos: ["wrapdotdev/warp", "mattpocock/skills"],
          },
        },
        { username: "schalkneethling" },
      ),
    ).toMatchObject({
      source: "starred",
      username: "schalkneethling",
      repoSelection: {
        kind: "subset",
        repos: ["wrapdotdev/warp", "mattpocock/skills"],
      },
    });
  });

  it("does not switch sources for neutral optional branch fields", () => {
    expect(
      applyDraftPatch(
        { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
        { ttl: 86400, username: null },
      ),
    ).toMatchObject({ source: "topics", topics: ["css"], ttl: 86400 });

    expect(
      applyDraftPatch(
        {
          ...DEFAULT_FEED_DRAFT,
          source: "starred",
          username: "octocat",
          repoSelection: { kind: "all" },
        },
        { ttl: 86400, topics: [] },
      ),
    ).toMatchObject({
      source: "starred",
      username: "octocat",
      repoSelection: { kind: "all" },
      ttl: 86400,
    });
  });

  it("rejects empty repository subsets instead of treating them as all repositories", () => {
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        draftPatch: { repoSelection: { kind: "subset", repos: [] } },
      }),
    ).toBe(false);
  });

  it("allows a complete request after the capability source choice", () => {
    expect(isLegalTransition("idle", "idle")).toBe(true);
    expect(isLegalTransition("choose-source", "ready")).toBe(true);
    expect(isLegalTransition("choose-source", "edit-settings")).toBe(true);
    expect(isLegalTransition("choose-source", "choose-repos")).toBe(false);
  });

  it("allows starred-feed transitions without weakening topic-only ones", () => {
    expect(isLegalTransition("idle", "enter-username")).toBe(true);
    expect(isLegalTransition("enter-username", "choose-repos")).toBe(true);
    expect(isLegalTransition("enter-username", "ready")).toBe(true);
    expect(isLegalTransition("choose-repos", "ready")).toBe(true);
    expect(isLegalTransition("ready", "choose-repos")).toBe(true);
    expect(isLegalTransition("recoverable-error", "enter-username")).toBe(true);
    expect(isLegalTransition("edit-topics", "ready")).toBe(true);
    expect(isLegalTransition("edit-topics", "enter-username")).toBe(false);
  });

  it("lets a starred conversation switch back to topic editing", () => {
    expect(isLegalTransition("enter-username", "edit-topics")).toBe(true);
    expect(isLegalTransition("choose-repos", "edit-topics")).toBe(true);
  });
});
