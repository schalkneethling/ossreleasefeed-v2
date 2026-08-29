import { describe, expect, it, vi } from "vitest";
import {
  adaptiveWorkspaceReducer,
  DEFAULT_ADAPTIVE_WORKSPACE,
  type AdaptiveAction,
  type AdaptiveWorkspace,
} from "../../frontend/src/lib/adaptive-session";
import { createFeedUrlForDraft } from "../../frontend/src/lib/feed-url";
import {
  createWebMcpTools,
  hasWebMcp,
  webMcpToolNamesForWorkspace,
  type WebMcpToolName,
} from "../../frontend/src/lib/webmcp";

type ToolResult = {
  ok: boolean;
  error?: { code: string; message: string; invalidTopics?: string[] };
  feedUrl?: string;
  workspace?: {
    state: string;
    draft: AdaptiveWorkspace["draft"];
    feedUrl: string | null;
    ttlSelected: boolean;
  };
};

type TopicValidator = (
  slug: string,
  signal?: AbortSignal,
) => Promise<{ exists: boolean; name: string | null }>;

const createHarness = (
  validateTopic = vi.fn<TopicValidator>(async (slug) => ({ exists: true, name: slug })),
) => {
  let workspace = DEFAULT_ADAPTIVE_WORKSPACE;
  const actions: AdaptiveAction[] = [];
  const applyAction = (action: AdaptiveAction): AdaptiveWorkspace => {
    actions.push(action);
    workspace = adaptiveWorkspaceReducer(workspace, action);
    return workspace;
  };
  const tools = () =>
    createWebMcpTools({
      applyAction,
      getWorkspace: () => workspace,
      validateTopic,
    });
  const tool = (name: WebMcpToolName) => {
    const match = tools().find((candidate) => candidate.name === name);

    if (!match) {
      throw new Error(`Expected ${name} to be registered.`);
    }

    return match;
  };
  const execute = async (
    name: WebMcpToolName,
    input: Record<string, unknown>,
    signal = new AbortController().signal,
  ): Promise<ToolResult> => (await tool(name).execute(input, { signal })) as ToolResult;

  return {
    actions,
    applyAction,
    execute,
    getWorkspace: () => workspace,
    tool,
    tools,
  };
};

const decodeFeedToken = (url: string): unknown => {
  const token = url.split("/feed/")[1];
  const base64 = token.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
};

describe("WebMCP tools", () => {
  it("exposes a read-only workspace tool without conversation or experiment data", async () => {
    const harness = createHarness();
    const tools = harness.tools();
    const readTool = harness.tool("read-feed-workspace");
    const result = await readTool.execute({}, { signal: new AbortController().signal });
    const serialized = JSON.stringify(result);

    expect(tools.map((tool) => tool.name)).toEqual(["read-feed-workspace", "choose-feed-source"]);
    expect(readTool.annotations).toEqual({ readOnlyHint: true });
    expect(result).toMatchObject({
      ok: true,
      workspace: {
        state: "idle",
        feedUrl: null,
        ttlSelected: false,
      },
    });
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("composer");
    expect(serialized).not.toContain("experiment");
  });

  it("builds a validated topic feed through dynamic tools and the existing reducer", async () => {
    const harness = createHarness();
    const capturedReadTool = harness.tool("read-feed-workspace");

    await harness.execute("choose-feed-source", { source: "topics" });

    expect(harness.actions.map((action) => action.type)).toEqual(["start-guided", "set-source"]);
    expect(harness.getWorkspace()).toMatchObject({
      builderStarted: true,
      adaptiveState: "edit-topics",
      draft: { source: "topics" },
    });
    expect(webMcpToolNamesForWorkspace(harness.getWorkspace())).toEqual([
      "read-feed-workspace",
      "choose-feed-source",
      "set-topics",
    ]);

    await harness.execute("set-topics", { topics: ["css", "typescript"] });

    expect(harness.getWorkspace()).toMatchObject({
      adaptiveState: "edit-settings",
      draft: { topics: ["css", "typescript"] },
      ttlSelected: false,
    });
    expect(webMcpToolNamesForWorkspace(harness.getWorkspace())).toContain("set-feed-settings");
    expect(webMcpToolNamesForWorkspace(harness.getWorkspace())).not.toContain("generate-feed-url");

    await harness.execute("set-feed-settings", { activityType: "all", ttl: 86400 });

    expect(harness.getWorkspace()).toMatchObject({
      draft: { activityType: "all", ttl: 86400 },
      ttlSelected: true,
    });
    expect(webMcpToolNamesForWorkspace(harness.getWorkspace())).toContain("generate-feed-url");

    const generated = await harness.execute("generate-feed-url", {});
    const readAfterGeneration = (await capturedReadTool.execute(
      {},
      { signal: new AbortController().signal },
    )) as ToolResult;

    expect(generated.ok).toBe(true);
    expect(generated.feedUrl).toMatch(/^\/feed\/[A-Za-z0-9_-]+$/u);
    expect(generated.feedUrl && decodeFeedToken(generated.feedUrl)).toEqual({
      activityType: "all",
      format: "atom",
      source: "topics",
      topicOperator: "or",
      topics: ["css", "typescript"],
      ttl: 86400,
    });
    expect(readAfterGeneration.workspace).toMatchObject({
      state: "ready",
      feedUrl: generated.feedUrl,
      ttlSelected: true,
    });
  });

  it("[webmcp_002] rejects invalid and unknown topics without mutating the workspace", async () => {
    const validateTopic = vi.fn<TopicValidator>(async (slug) => ({
      exists: slug !== "unknown-topic",
      name: slug,
    }));
    const harness = createHarness(validateTopic);
    await harness.execute("choose-feed-source", { source: "topics" });
    const revision = harness.getWorkspace().revision;

    const invalid = await harness.execute("set-topics", {
      topics: ["one", "two", "three", "four", "five", "six"],
    });
    const unknown = await harness.execute("set-topics", { topics: ["unknown-topic"] });

    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(unknown).toMatchObject({
      ok: false,
      error: { code: "unknown-topics", invalidTopics: ["unknown-topic"] },
    });
    expect(harness.getWorkspace().revision).toBe(revision);
    expect(harness.getWorkspace().draft.topics).toEqual([]);
  });

  it("honors execution cancellation before validation or mutation", async () => {
    const validateTopic = vi.fn<TopicValidator>(async (slug) => ({ exists: true, name: slug }));
    const harness = createHarness(validateTopic);
    await harness.execute("choose-feed-source", { source: "topics" });
    const revision = harness.getWorkspace().revision;
    const controller = new AbortController();
    const reason = new DOMException("Stopped", "AbortError");
    controller.abort(reason);

    await expect(
      harness.execute("set-topics", { topics: ["css"] }, controller.signal),
    ).rejects.toBe(reason);
    expect(validateTopic).not.toHaveBeenCalled();
    expect(harness.getWorkspace().revision).toBe(revision);
  });

  it("does not apply asynchronously validated topics over a newer workspace revision", async () => {
    let resolveValidation: ((value: { exists: boolean; name: string }) => void) | undefined;
    const validateTopic = vi.fn<TopicValidator>(
      () =>
        new Promise<{ exists: boolean; name: string }>((resolve) => {
          resolveValidation = resolve;
        }),
    );
    const harness = createHarness(validateTopic);
    await harness.execute("choose-feed-source", { source: "topics" });
    const pending = harness.execute("set-topics", { topics: ["css"] });
    harness.applyAction({ type: "set-activity", activityType: "all" });

    if (!resolveValidation) {
      throw new Error("Expected topic validation to start.");
    }

    resolveValidation({ exists: true, name: "css" });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "stale-workspace" },
    });
    expect(harness.getWorkspace().draft.topics).toEqual([]);
    expect(harness.getWorkspace().draft.activityType).toBe("all");
  });

  it("[webmcp_003] rechecks state when a previously discovered generate tool is invoked", async () => {
    const harness = createHarness();
    await harness.execute("choose-feed-source", { source: "topics" });
    await harness.execute("set-topics", { topics: ["css"] });
    await harness.execute("set-feed-settings", { activityType: "releases", ttl: 3600 });
    const capturedGenerate = harness.tool("generate-feed-url");
    harness.applyAction({ type: "set-source", source: null });

    const result = (await capturedGenerate.execute(
      {},
      { signal: new AbortController().signal },
    )) as ToolResult;

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-state" } });
    expect(harness.getWorkspace().feedUrl).toBeNull();
  });

  it("feature-detects the native document model context", () => {
    const registerTool = vi.fn<WebMCP.ModelContext["registerTool"]>(async () => undefined);
    const modelContext = { registerTool } as unknown as WebMCP.ModelContext;

    expect(hasWebMcp({ modelContext } as Document)).toBe(true);
    expect(hasWebMcp({} as Document)).toBe(false);
  });
});

describe("feed URL generation shared with WebMCP", () => {
  it("preserves the existing starred-repository encoding path", () => {
    const generated = createFeedUrlForDraft({
      ...DEFAULT_ADAPTIVE_WORKSPACE.draft,
      source: "starred",
      username: "octocat",
      repoSelection: { kind: "subset", repos: ["octocat/Hello-World"] },
      activityType: "releases",
      ttl: 21600,
    });

    expect(generated).toMatch(/^\/feed\/[A-Za-z0-9_-]+$/u);
    expect(generated && decodeFeedToken(generated)).toEqual({
      activityType: "releases",
      format: "atom",
      repos: ["octocat/Hello-World"],
      source: "starred",
      ttl: 21600,
      username: "octocat",
    });
  });
});
