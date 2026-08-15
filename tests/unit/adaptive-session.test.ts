import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adaptiveWorkspaceReducer,
  ADAPTIVE_SESSION_MAX_AGE_MS,
  ADAPTIVE_SESSION_VERSION,
  capTranscript,
  DEFAULT_ADAPTIVE_WORKSPACE,
  parsePersistedWorkspace,
  persistAdaptiveWorkspace,
} from "../../frontend/src/lib/adaptive-session";

const readyResponse = {
  state: "ready" as const,
  draft: {
    ...DEFAULT_ADAPTIVE_WORKSPACE.draft,
    source: "topics" as const,
    topics: ["css"],
  },
  message: "Your topic feed is ready.",
  issues: [],
  feedUrl: "https://example.com/feed/token",
  showUi: true,
  ttlSelected: true,
};

describe("adaptive workspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares controlled draft changes and clears a stale generated URL", () => {
    const withTopics = adaptiveWorkspaceReducer(DEFAULT_ADAPTIVE_WORKSPACE, {
      type: "set-topics",
      topics: ["css"],
    });
    const ready = adaptiveWorkspaceReducer(withTopics, {
      type: "set-feed-url",
      feedUrl: "https://example.com/feed/token",
    });
    const changed = adaptiveWorkspaceReducer(ready, {
      type: "set-ttl",
      ttl: 86400,
    });

    expect(ready.ttlSelected).toBe(false);
    expect(changed.draft).toMatchObject({
      source: "topics",
      topics: ["css"],
      ttl: 86400,
    });
    expect(changed.adaptiveState).toBe("edit-settings");
    expect(changed.feedUrl).toBeNull();
    expect(changed.ttlSelected).toBe(true);
  });

  it("reveals controls only for Ask-mode builder actions", () => {
    const guided = adaptiveWorkspaceReducer(DEFAULT_ADAPTIVE_WORKSPACE, {
      type: "set-topics",
      topics: ["css"],
    });
    const ask = adaptiveWorkspaceReducer(
      { ...DEFAULT_ADAPTIVE_WORKSPACE, selectedMode: "ask" },
      { type: "set-topics", topics: ["css"] },
    );

    expect(guided.showUi).toBe(false);
    expect(ask.showUi).toBe(true);
  });

  it("records a successful assistant turn and preserves it across mode changes", () => {
    const result = adaptiveWorkspaceReducer(DEFAULT_ADAPTIVE_WORKSPACE, {
      type: "assistant-result",
      userMessage: "Create a CSS feed",
      response: readyResponse,
    });
    const guided = adaptiveWorkspaceReducer(result, { type: "fallback-guided" });

    expect(guided.selectedMode).toBe("guided");
    expect(guided.builderStarted).toBe(true);
    expect(guided.draft.topics).toEqual(["css"]);
    expect(guided.feedUrl).toBe("https://example.com/feed/token");
    expect(guided.transcript).toEqual([
      { role: "user", content: "Create a CSS feed" },
      { role: "assistant", content: "Your topic feed is ready." },
    ]);
  });

  it("caps restored conversation context by turn and character limits", () => {
    const transcript = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn-${index}`,
    }));

    expect(capTranscript(transcript)).toHaveLength(12);
    expect(capTranscript(transcript)[0].content).toBe("turn-8");
  });

  it("restores a current, internally consistent versioned session", () => {
    const now = Date.UTC(2026, 6, 19);
    const serialized = JSON.stringify({
      ...DEFAULT_ADAPTIVE_WORKSPACE,
      adaptiveState: "ready",
      draft: readyResponse.draft,
      feedUrl: readyResponse.feedUrl,
      showUi: true,
      ttlSelected: true,
      transcript: [
        { role: "user", content: "Create a CSS feed" },
        { role: "assistant", content: "Your topic feed is ready." },
      ],
      composer: "Change it to TypeScript",
      selectedMode: "ask",
      version: ADAPTIVE_SESSION_VERSION,
      savedAt: now - 1_000,
    });

    expect(parsePersistedWorkspace(serialized, now)).toMatchObject({
      adaptiveState: "ready",
      draft: { source: "topics", topics: ["css"] },
      selectedMode: "ask",
      composer: "Change it to TypeScript",
    });
  });

  it("restores a Guided URL without treating the default interval as an Ask selection", () => {
    const now = Date.UTC(2026, 6, 19);
    const serialized = JSON.stringify({
      ...DEFAULT_ADAPTIVE_WORKSPACE,
      adaptiveState: "ready",
      draft: readyResponse.draft,
      feedUrl: readyResponse.feedUrl,
      showUi: true,
      version: ADAPTIVE_SESSION_VERSION,
      savedAt: now,
    });

    expect(parsePersistedWorkspace(serialized, now)).toMatchObject({
      adaptiveState: "ready",
      selectedMode: "guided",
      ttlSelected: false,
    });
  });

  it("rejects expired, mismatched, and stale-URL sessions", () => {
    const now = Date.UTC(2026, 6, 19);
    const base = {
      ...DEFAULT_ADAPTIVE_WORKSPACE,
      version: ADAPTIVE_SESSION_VERSION,
      savedAt: now,
    };

    expect(
      parsePersistedWorkspace(
        JSON.stringify({ ...base, savedAt: now - ADAPTIVE_SESSION_MAX_AGE_MS - 1 }),
        now,
      ),
    ).toBeNull();
    expect(
      parsePersistedWorkspace(
        JSON.stringify({ ...base, adaptiveState: "ready", feedUrl: null }),
        now,
      ),
    ).toBeNull();
    expect(
      parsePersistedWorkspace(
        JSON.stringify({ ...base, feedUrl: "https://example.com/feed/stale" }),
        now,
      ),
    ).toBeNull();
    expect(
      parsePersistedWorkspace(
        JSON.stringify({
          ...base,
          adaptiveState: "ready",
          draft: readyResponse.draft,
          feedUrl: readyResponse.feedUrl,
          showUi: false,
        }),
        now,
      ),
    ).toBeNull();
    expect(
      parsePersistedWorkspace(
        JSON.stringify({
          ...base,
          adaptiveState: "edit-settings",
          draft: {
            ...base.draft,
            source: "topics",
            topics: ["Bad_Topic"],
          },
        }),
        now,
      ),
    ).toBeNull();
  });

  it("caps composer and issue data before writing a persisted session", () => {
    const setItem = vi.fn<(key: string, value: string) => void>();
    vi.stubGlobal("window", {
      localStorage: { setItem },
    });

    persistAdaptiveWorkspace({
      ...DEFAULT_ADAPTIVE_WORKSPACE,
      composer: "x".repeat(10_100),
      issues: Array.from({ length: 8 }, (_, index) => `Issue ${index}`),
    });

    const serialized = setItem.mock.calls[0]?.[1] as string;
    const persisted = JSON.parse(serialized) as { composer: string; issues: string[] };

    expect(persisted.composer).toHaveLength(10_000);
    expect(persisted.issues).toEqual(["Issue 0", "Issue 1", "Issue 2", "Issue 3", "Issue 4"]);
  });
});
