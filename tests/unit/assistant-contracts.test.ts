import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_DRAFT,
  isAssistantTurnRequest,
  isModelDecision,
} from "../../worker/src/assistant/contracts";
import { applyDraftPatch, isLegalTransition } from "../../worker/src/assistant/state";

const validRequest = {
  message: "Create a CSS feed",
  history: [],
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

  it("rejects overlong messages, too much history, and unknown fields", () => {
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        message: "x".repeat(1001),
      }),
    ).toBe(false);
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        history: Array.from({ length: 7 }, () => ({ role: "user", content: "next" })),
      }),
    ).toBe(false);
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        extra: true,
      }),
    ).toBe(false);
  });

  it("accepts request values at their message and history boundaries", () => {
    expect(
      isAssistantTurnRequest({
        ...validRequest,
        message: "x".repeat(1_000),
        history: Array.from({ length: 6 }, () => ({ role: "user", content: "next" })),
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
