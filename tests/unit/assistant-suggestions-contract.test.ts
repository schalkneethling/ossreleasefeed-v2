import { describe, expect, it } from "vitest";
import { isSuggestionList } from "../../frontend/src/lib/assistant";
import { DEFAULT_FEED_DRAFT, type FeedDraft } from "../../worker/src/assistant/contracts";
import { suggestionsFor } from "../../worker/src/assistant/planner";

// The Worker owns the suggestion copy and the browser rejects any response whose
// list breaks the wire rules, so every list the planner can produce must pass
// the browser's guard.
const topics: FeedDraft = { ...DEFAULT_FEED_DRAFT, source: "topics", topics: ["css"] };
const starred: FeedDraft = { ...DEFAULT_FEED_DRAFT, source: "starred", username: "octocat" };

const responses = [
  { state: "choose-source", draft: DEFAULT_FEED_DRAFT, issues: [], ttlSelected: false },
  { state: "edit-topics", draft: { ...topics, topics: [] }, issues: [], ttlSelected: false },
  {
    state: "enter-username",
    draft: { ...starred, username: null },
    issues: [],
    ttlSelected: false,
  },
  { state: "choose-repos", draft: starred, issues: [], ttlSelected: false },
  { state: "edit-settings", draft: topics, issues: [], ttlSelected: false },
  { state: "edit-topics", draft: topics, issues: ["Check: nope"], ttlSelected: true },
  { state: "ready", draft: topics, issues: [], ttlSelected: true },
] as const;

describe("suggestion lists cross the wire", () => {
  for (const showUi of [false, true]) {
    for (const response of responses) {
      it(`accepts the ${response.state} list (showUi ${showUi})`, () => {
        const hints = ["24 hours", "Include all of them", "Create a topic feed"];

        expect(isSuggestionList(suggestionsFor({ ...response, showUi }))).toBe(true);
        expect(isSuggestionList(suggestionsFor({ ...response, showUi }, hints))).toBe(true);
      });
    }
  }
});
