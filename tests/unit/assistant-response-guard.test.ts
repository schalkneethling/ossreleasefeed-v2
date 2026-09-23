import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_DRAFT,
  isAssistantTurnResponse,
  isSuggestionList,
} from "../../frontend/src/lib/assistant";

const responseWith = (suggestions: unknown): Record<string, unknown> => ({
  state: "edit-settings",
  draft: { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] },
  message: "How often should the feed update?",
  issues: [],
  feedUrl: null,
  showUi: false,
  ttlSelected: false,
  suggestions,
});

const invalidSuggestionLists: Array<[string, unknown]> = [
  ["a non-array", "24 hours"],
  ["a null list", null],
  ["five items", ["1 hour", "6 hours", "24 hours", "1 week", "Show UI"]],
  ["an empty string", ["24 hours", ""]],
  ["a suggestion of 61 characters", ["x".repeat(61)]],
  ["leading whitespace", [" 24 hours"]],
  ["trailing whitespace", ["24 hours "]],
  ["duplicates", ["24 hours", "24 hours"]],
  ["a non-string item", ["24 hours", 24]],
];

describe("assistant turn response guard", () => {
  it("accepts a response with no suggestions", () => {
    expect(isAssistantTurnResponse(responseWith([]))).toBe(true);
  });

  it("accepts a response with a valid suggestion list", () => {
    expect(isAssistantTurnResponse(responseWith(["1 hour", "6 hours", "24 hours", "1 week"]))).toBe(
      true,
    );
    expect(isAssistantTurnResponse(responseWith(["x".repeat(60)]))).toBe(true);
  });

  it("rejects a response without the suggestions field", () => {
    const { suggestions: _suggestions, ...withoutSuggestions } = responseWith([]);

    expect(isAssistantTurnResponse(withoutSuggestions)).toBe(false);
  });

  it.each(invalidSuggestionLists)("rejects a response with %s", (_label, suggestions) => {
    expect(isAssistantTurnResponse(responseWith(suggestions))).toBe(false);
  });

  it.each(invalidSuggestionLists)(
    "shares the rule with isSuggestionList for %s",
    (_label, list) => {
      expect(isSuggestionList(list)).toBe(false);
    },
  );

  it("accepts the same valid lists through isSuggestionList", () => {
    expect(isSuggestionList([])).toBe(true);
    expect(isSuggestionList(["Create a topic feed", "Use starred repositories"])).toBe(true);
  });
});
