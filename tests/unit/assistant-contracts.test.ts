import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_DRAFT,
  isAssistantTurnRequest,
  isModelDecision,
} from "../../worker/src/assistant/contracts";
import { applyDraftPatch, isLegalTransition } from "../../worker/src/assistant/state";

describe("assistant contracts", () => {
  it("accepts the version-one request contract", () => {
    expect(
      isAssistantTurnRequest({
        message: "Create a CSS feed",
        history: [],
        state: "idle",
        draft: DEFAULT_FEED_DRAFT,
      }),
    ).toBe(true);
  });

  it("rejects overlong messages, too much history, and unknown fields", () => {
    expect(
      isAssistantTurnRequest({
        message: "x".repeat(1001),
        history: [],
        state: "idle",
        draft: DEFAULT_FEED_DRAFT,
      }),
    ).toBe(false);
    expect(
      isAssistantTurnRequest({
        message: "Create a feed",
        history: Array.from({ length: 7 }, () => ({ role: "user", content: "next" })),
        state: "idle",
        draft: DEFAULT_FEED_DRAFT,
      }),
    ).toBe(false);
    expect(
      isAssistantTurnRequest({
        message: "Create a feed",
        history: [],
        state: "idle",
        draft: DEFAULT_FEED_DRAFT,
        extra: true,
      }),
    ).toBe(false);
  });

  it("accepts request values at their message and history boundaries", () => {
    expect(
      isAssistantTurnRequest({
        message: "x".repeat(1_000),
        history: Array.from({ length: 6 }, () => ({ role: "user", content: "next" })),
        state: "idle",
        draft: DEFAULT_FEED_DRAFT,
      }),
    ).toBe(true);
  });

  it("rejects an empty request message", () => {
    expect(
      isAssistantTurnRequest({
        message: "",
        history: [],
        state: "idle",
        draft: DEFAULT_FEED_DRAFT,
      }),
    ).toBe(false);
  });

  it("rejects model URLs and unknown model fields", () => {
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        proposedState: "ready",
        draftPatch: { source: "topics", topics: ["css"] },
        feedUrl: "https://malicious.example/feed",
      }),
    ).toBe(false);
  });

  it("accepts a valid model decision without a feed URL", () => {
    expect(
      isModelDecision({
        intent: "create-or-update-feed",
        proposedState: "edit-topics",
        draftPatch: { source: "topics", topics: [] },
        framing: "Choose a topic.",
      }),
    ).toBe(true);
  });

  it("preserves an explicitly cleared source instead of inferring topics", () => {
    expect(
      applyDraftPatch(
        { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
        { source: null },
      ),
    ).toMatchObject({ source: null, topics: ["css"] });
  });

  it("allows a complete request after the capability source choice", () => {
    expect(isLegalTransition("choose-source", "ready")).toBe(true);
    expect(isLegalTransition("choose-source", "edit-settings")).toBe(true);
    expect(isLegalTransition("choose-source", "choose-repos")).toBe(false);
  });
});
