import { FEED_TTLS, type FeedDraft } from "./assistant";
import { validateTopic, type TopicValidation } from "./api";
import { type AdaptiveAction, type AdaptiveWorkspace } from "./adaptive-session";
import { createFeedUrlForDraft } from "./feed-url";

const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,34}$/u;
const ACTIVITY_TYPES = ["releases", "all"] as const;

export const WEBMCP_TOOL_NAMES = [
  "read-feed-workspace",
  "choose-feed-source",
  "set-topics",
  "set-feed-settings",
  "generate-feed-url",
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

type WebMcpDependencies = {
  applyAction: (action: AdaptiveAction) => AdaptiveWorkspace;
  getWorkspace: () => AdaptiveWorkspace;
  mutations?: WebMcpMutationCoordinator;
  validateTopic?: (slug: string, signal?: AbortSignal) => Promise<TopicValidation>;
};

type WorkspaceSnapshot = {
  state: AdaptiveWorkspace["adaptiveState"];
  draft: FeedDraft;
  issues: string[];
  feedUrl: string | null;
  ttlSelected: boolean;
};

type ToolFailureCode = "invalid-input" | "invalid-state" | "stale-workspace" | "unknown-topics";

type WebMcpExecutionOptions = Partial<WebMCP.ToolExecuteCallbackOptions>;

type WebMcpMutation = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
};

/**
 * Coordinates mutations from one WebMCP-capable page.
 *
 * Newer mutations and any visible UI mutation revoke older WebMCP work. A
 * revision check remains in each asynchronous tool as the final safeguard, in
 * case a request ignores abort cancellation while it is settling.
 */
export type WebMcpMutationCoordinator = {
  begin: () => WebMcpMutation;
  invalidate: () => void;
};

const abortMutation = (controller: AbortController): void => {
  if (!controller.signal.aborted) {
    controller.abort(new DOMException("Superseded by a newer workspace mutation.", "AbortError"));
  }
};

export const createWebMcpMutationCoordinator = (): WebMcpMutationCoordinator => {
  let current: { id: number; controller: AbortController } | null = null;
  let nextId = 0;

  return {
    begin() {
      if (current) {
        abortMutation(current.controller);
      }

      const entry = { id: nextId + 1, controller: new AbortController() };
      nextId = entry.id;
      current = entry;

      return {
        signal: entry.controller.signal,
        isCurrent: () => current?.id === entry.id && !entry.controller.signal.aborted,
        finish: () => {
          if (current?.id === entry.id) {
            current = null;
          }
        },
      };
    },
    invalidate() {
      if (current) {
        abortMutation(current.controller);
        current = null;
      }

      nextId += 1;
    },
  };
};

const combineAbortSignals = (
  signals: readonly (AbortSignal | undefined)[],
): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

  const abortFrom = (signal: AbortSignal): void => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of signals) {
    if (!signal) {
      continue;
    }

    if (signal.aborted) {
      abortFrom(signal);
      break;
    }

    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      listeners.forEach(({ signal, listener }) => {
        signal.removeEventListener("abort", listener);
      });
    },
  };
};

const executeMutation = async <Result>(
  mutations: WebMcpMutationCoordinator,
  options: WebMcpExecutionOptions | undefined,
  execute: (signal: AbortSignal, isCurrent: () => boolean) => Result | Promise<Result>,
): Promise<Result> => {
  const mutation = mutations.begin();
  const { signal, dispose } = combineAbortSignals([mutation.signal, options?.signal]);

  try {
    return await execute(signal, mutation.isCurrent);
  } finally {
    dispose();
    mutation.finish();
  }
};

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  signal?.throwIfAborted();
};

const toolFailure = (
  code: ToolFailureCode,
  message: string,
  details: Record<string, unknown> = {},
) => ({
  ok: false,
  error: { code, message, ...details },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value);

  return keys.length === expected.length && keys.every((key) => expected.includes(key));
};

const snapshotWorkspace = (workspace: AdaptiveWorkspace): WorkspaceSnapshot => ({
  state: workspace.adaptiveState,
  draft: {
    ...workspace.draft,
    topics: [...workspace.draft.topics],
    repoSelection:
      workspace.draft.repoSelection?.kind === "subset"
        ? { kind: "subset", repos: [...workspace.draft.repoSelection.repos] }
        : workspace.draft.repoSelection,
  },
  issues: [...workspace.issues],
  feedUrl: workspace.feedUrl,
  ttlSelected: workspace.ttlSelected,
});

const normalizeTopics = (topics: readonly string[]): string[] => [
  ...new Set(topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean)),
];

const readSource = (input: Record<string, unknown>): "topics" => {
  if (!hasExactKeys(input, ["source"]) || input.source !== "topics") {
    throw new TypeError('source must be exactly "topics" for this WebMCP vertical slice.');
  }

  return input.source;
};

const readTopics = (input: Record<string, unknown>): string[] => {
  if (
    !hasExactKeys(input, ["topics"]) ||
    !Array.isArray(input.topics) ||
    !input.topics.every((topic) => typeof topic === "string")
  ) {
    throw new TypeError("topics must be an array of GitHub topic slugs.");
  }

  const normalized = normalizeTopics(input.topics);

  if (
    normalized.length < 1 ||
    normalized.length > 5 ||
    normalized.some((topic) => !TOPIC_SLUG.test(topic))
  ) {
    throw new TypeError(
      "topics must contain between one and five unique, valid GitHub topic slugs.",
    );
  }

  return normalized;
};

const readSettings = (
  input: Record<string, unknown>,
): { activityType: FeedDraft["activityType"]; ttl: FeedDraft["ttl"] } => {
  if (
    !hasExactKeys(input, ["activityType", "ttl"]) ||
    !ACTIVITY_TYPES.some((activityType) => activityType === input.activityType) ||
    !FEED_TTLS.some((ttl) => ttl === input.ttl)
  ) {
    throw new TypeError("activityType and ttl must match the supported feed settings exactly.");
  }

  return {
    activityType: input.activityType as FeedDraft["activityType"],
    ttl: input.ttl as FeedDraft["ttl"],
  };
};

const requireTopicWorkspace = (workspace: AdaptiveWorkspace): void => {
  if (workspace.draft.source !== "topics") {
    throw new Error("The active workspace is not configuring a topic feed.");
  }
};

export const webMcpToolNamesForWorkspace = (workspace: AdaptiveWorkspace): WebMcpToolName[] => {
  const names: WebMcpToolName[] = ["read-feed-workspace", "choose-feed-source"];

  if (workspace.draft.source !== "topics") {
    return names;
  }

  names.push("set-topics");

  if (workspace.draft.topics.length === 0) {
    return names;
  }

  names.push("set-feed-settings");

  if (workspace.ttlSelected) {
    names.push("generate-feed-url");
  }

  return names;
};

export const webMcpAvailabilityKey = (workspace: AdaptiveWorkspace): string =>
  webMcpToolNamesForWorkspace(workspace).join("|");

export const hasWebMcp = (targetDocument: Document = document): boolean =>
  typeof targetDocument.modelContext?.registerTool === "function";

export const createWebMcpTools = ({
  applyAction,
  getWorkspace,
  mutations = createWebMcpMutationCoordinator(),
  validateTopic: validateTopicDependency = validateTopic,
}: WebMcpDependencies): WebMCP.ModelContextTool[] => {
  const tools: Record<WebMcpToolName, WebMCP.ModelContextTool> = {
    "read-feed-workspace": {
      name: "read-feed-workspace",
      title: "Read the feed workspace",
      description:
        "Read the current validated OSSReleaseFeed draft, workflow state, issues, and generated URL. This does not return conversation text or experiment identifiers.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(input, options?: WebMcpExecutionOptions) {
        throwIfAborted(options?.signal);

        if (!isRecord(input) || !hasExactKeys(input, [])) {
          return toolFailure("invalid-input", "This tool does not accept input properties.");
        }

        return { ok: true, workspace: snapshotWorkspace(getWorkspace()) };
      },
    },
    "choose-feed-source": {
      name: "choose-feed-source",
      title: "Choose a feed source",
      description:
        "Start or switch the visible builder to a GitHub topic feed. The first WebMCP vertical slice supports topic feeds.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["topics"],
            description: "The supported feed source for this vertical slice.",
          },
        },
        required: ["source"],
        additionalProperties: false,
      },
      execute(input, options?: WebMcpExecutionOptions) {
        return executeMutation(mutations, options, (signal) => {
          throwIfAborted(signal);

          if (!isRecord(input)) {
            return toolFailure("invalid-input", "Tool input must be an object.");
          }

          let source: "topics";

          try {
            source = readSource(input);
          } catch (error) {
            return toolFailure(
              "invalid-input",
              error instanceof Error ? error.message : "The feed source is invalid.",
            );
          }

          const workspace = getWorkspace();

          if (workspace.selectedMode === "guided" && !workspace.builderStarted) {
            applyAction({ type: "start-guided" });
          }

          const next = applyAction({ type: "set-source", source });

          return {
            ok: true,
            message: "The visible builder is ready for GitHub topics.",
            workspace: snapshotWorkspace(next),
          };
        });
      },
    },
    "set-topics": {
      name: "set-topics",
      title: "Set GitHub topics",
      description:
        "Validate and set one to five GitHub topic slugs in the visible topic-feed builder.",
      inputSchema: {
        type: "object",
        properties: {
          topics: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            uniqueItems: true,
            items: {
              type: "string",
              pattern: "^[a-z0-9][a-z0-9-]{0,34}$",
              description: "A lowercase GitHub topic slug.",
            },
          },
        },
        required: ["topics"],
        additionalProperties: false,
      },
      execute(input, options?: WebMcpExecutionOptions) {
        return executeMutation(mutations, options, async (signal, isCurrent) => {
          throwIfAborted(signal);

          if (!isRecord(input)) {
            return toolFailure("invalid-input", "Tool input must be an object.");
          }

          const workspace = getWorkspace();

          try {
            requireTopicWorkspace(workspace);
          } catch (error) {
            return toolFailure(
              "invalid-state",
              error instanceof Error ? error.message : "The feed workspace is invalid.",
            );
          }

          const baseRevision = workspace.revision;
          let topics: string[];

          try {
            topics = readTopics(input);
          } catch (error) {
            return toolFailure(
              "invalid-input",
              error instanceof Error ? error.message : "The topic selection is invalid.",
            );
          }

          let validations: TopicValidation[];

          try {
            validations = await Promise.all(
              topics.map((topic) => validateTopicDependency(topic, signal)),
            );
            throwIfAborted(signal);
          } catch (error) {
            if (!isCurrent() && !options?.signal?.aborted) {
              return toolFailure(
                "stale-workspace",
                "The feed workspace changed while topics were being validated.",
              );
            }

            throw error;
          }

          const invalidTopics = topics.filter((_, index) => !validations[index]?.exists);

          if (invalidTopics.length > 0) {
            return toolFailure(
              "unknown-topics",
              `Unknown GitHub topics: ${invalidTopics.join(", ")}.`,
              { invalidTopics },
            );
          }

          const current = getWorkspace();

          if (
            !isCurrent() ||
            current.revision !== baseRevision ||
            current.draft.source !== "topics"
          ) {
            return toolFailure(
              "stale-workspace",
              "The feed workspace changed while topics were being validated.",
            );
          }

          const canonicalTopics = validations.map((validation, index) =>
            (validation.name ?? topics[index]).toLowerCase(),
          );
          const next = applyAction({ type: "set-topics", topics: canonicalTopics });

          return {
            ok: true,
            message: `Validated and selected ${canonicalTopics.length} GitHub topic${canonicalTopics.length === 1 ? "" : "s"}.`,
            workspace: snapshotWorkspace(next),
          };
        });
      },
    },
    "set-feed-settings": {
      name: "set-feed-settings",
      title: "Set feed settings",
      description:
        "Set the activity type and update frequency for the active topic feed. Supported frequencies are 1 hour, 6 hours, 24 hours, and 1 week.",
      inputSchema: {
        type: "object",
        properties: {
          activityType: {
            type: "string",
            enum: ["releases", "all"],
            description: "Use releases for releases only, or all for releases plus issues.",
          },
          ttl: {
            type: "number",
            enum: [3600, 21600, 86400, 604800],
            description: "Update frequency in seconds: 1 hour, 6 hours, 24 hours, or 1 week.",
          },
        },
        required: ["activityType", "ttl"],
        additionalProperties: false,
      },
      execute(input, options?: WebMcpExecutionOptions) {
        return executeMutation(mutations, options, (signal) => {
          throwIfAborted(signal);

          if (!isRecord(input)) {
            return toolFailure("invalid-input", "Tool input must be an object.");
          }

          const workspace = getWorkspace();

          try {
            requireTopicWorkspace(workspace);
          } catch (error) {
            return toolFailure(
              "invalid-state",
              error instanceof Error ? error.message : "The feed workspace is invalid.",
            );
          }

          if (workspace.draft.topics.length === 0) {
            return toolFailure(
              "invalid-state",
              "Select at least one validated topic before changing feed settings.",
            );
          }

          let settings: { activityType: FeedDraft["activityType"]; ttl: FeedDraft["ttl"] };

          try {
            settings = readSettings(input);
          } catch (error) {
            return toolFailure(
              "invalid-input",
              error instanceof Error ? error.message : "The feed settings are invalid.",
            );
          }

          applyAction({ type: "set-activity", activityType: settings.activityType });
          const next = applyAction({ type: "set-ttl", ttl: settings.ttl });

          return {
            ok: true,
            message: "The feed settings were applied to the visible builder.",
            workspace: snapshotWorkspace(next),
          };
        });
      },
    },
    "generate-feed-url": {
      name: "generate-feed-url",
      title: "Generate the feed URL",
      description:
        "Generate and display the permanent Atom feed URL for the complete, validated topic-feed draft.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute(input, options?: WebMcpExecutionOptions) {
        return executeMutation(mutations, options, (signal) => {
          throwIfAborted(signal);

          if (!isRecord(input) || !hasExactKeys(input, [])) {
            return toolFailure("invalid-input", "This tool does not accept input properties.");
          }

          const workspace = getWorkspace();

          try {
            requireTopicWorkspace(workspace);
          } catch (error) {
            return toolFailure(
              "invalid-state",
              error instanceof Error ? error.message : "The feed workspace is invalid.",
            );
          }

          if (workspace.draft.topics.length === 0 || !workspace.ttlSelected) {
            return toolFailure(
              "invalid-state",
              "Complete the topic selection and feed settings before generating a URL.",
            );
          }

          const generatedUrl = createFeedUrlForDraft(workspace.draft);

          if (generatedUrl === null) {
            return toolFailure("invalid-state", "The current feed draft is incomplete.");
          }

          const next = applyAction({ type: "set-feed-url", feedUrl: generatedUrl });

          return {
            ok: true,
            message: "The permanent feed URL is ready and visible in the builder.",
            feedUrl: generatedUrl,
            workspace: snapshotWorkspace(next),
          };
        });
      },
    },
  };

  return webMcpToolNamesForWorkspace(getWorkspace()).map((name) => tools[name]);
};
