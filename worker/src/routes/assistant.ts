import { Duration, Effect } from "effect";
import { Hono, type Context } from "hono";
import {
  MAX_EXPLICIT_REPOSITORIES,
  type AssistantTurnRequest,
  type FeedDraft,
  isAssistantTurnRequest,
  type ModelDecision,
} from "../assistant/contracts";
import {
  extractExplicitRepositoryNames,
  TOPIC_SLUG,
  USERNAME_PATTERN,
} from "../assistant/entities";
import { evaluateAdaptiveFeedBuilder, readExperimentKey } from "../assistant/experiment";
import { interpretWithLlama, MODEL } from "../assistant/interpreter/llama";
import { AssistantModelError, type Interpreter } from "../assistant/interpreter/types";
import {
  CAPABILITIES_MESSAGE,
  SETTINGS_ISSUE,
  SETTINGS_OPTIONS_MESSAGE,
  TOPIC_LIMIT_ISSUE,
  canFinalizeDraft,
  createStarredFeedUrl,
  createTopicFeedUrl,
  isReadOnlyDecisionValid,
  mergeRepositoryNames,
  normalizeModelPatch,
  requiredDecisionFor,
  responseFor,
  selectionMessage,
  stateForVisibleUi,
  unsupportedDetails,
} from "../assistant/planner";
import { applyDraftPatch, isStateConsistentWithDraft } from "../assistant/state";
import { GitHubClient } from "../github/client";
import { runEffect } from "../lib/run";
import type { AppEnv } from "../lib/types";
import { editableStateForDraft, isRepoSelectionComplete } from "../../../shared/adaptive-contracts";

export const assistantRoutes = new Hono<AppEnv>();

const MAX_BODY_BYTES = 8_192;
// Conversation history is presentation-only client state and is not accepted
// by this route or forwarded to the model. The validated draft and derived
// required decision carry authoritative workflow context.
// GitHub lookups in the assistant request path are bounded so a slow or hung
// upstream response cannot hold the turn open; a deadline reaches the same
// 503 response as a lookup failure.
const GITHUB_LOOKUP_TIMEOUT = Duration.seconds(10);

type AssistantFailureStage =
  | "workers-ai"
  | "model-output"
  | "read-only-mutation"
  | "repository-action-context"
  | "repository-list-context";

const errorProperty = (error: unknown, property: string): string | number | undefined => {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return undefined;
  }

  const value: unknown = Reflect.get(error, property);

  return typeof value === "string" || typeof value === "number" ? value : undefined;
};

const logAssistantFailure = (
  stage: AssistantFailureStage,
  error?: unknown,
  intent?: ModelDecision["intent"],
): void => {
  // oxlint-disable-next-line no-console -- Structured Worker diagnostics are the intended output.
  console.error({
    event: "assistant_turn_failure",
    stage,
    model: MODEL,
    ...(intent === undefined ? {} : { intent }),
    ...(error instanceof Error ? { errorName: error.name, errorMessage: error.message } : {}),
    ...(errorProperty(error, "code") === undefined
      ? {}
      : { errorCode: errorProperty(error, "code") }),
    ...(errorProperty(error, "status") === undefined
      ? {}
      : { errorStatus: errorProperty(error, "status") }),
  });
};

const readBody = async (request: Request): Promise<unknown> => {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");

  if (contentLength > MAX_BODY_BYTES) {
    throw new RangeError("body-too-large");
  }

  if (!request.body) {
    return JSON.parse("");
  }

  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value.byteLength > MAX_BODY_BYTES - byteLength) {
        try {
          await reader.cancel("body-too-large");
        } catch {
          // The size error remains authoritative if stream cancellation also fails.
        }

        throw new RangeError("body-too-large");
      }

      bytes.set(value, byteLength);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (byteLength > MAX_BODY_BYTES) {
    throw new RangeError("body-too-large");
  }

  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, byteLength)));
};

const checkRateLimits = async (ctx: Parameters<typeof evaluateAdaptiveFeedBuilder>[0]) => {
  const clientKey = readExperimentKey(ctx.req.raw);
  const networkKey = ctx.req.header("CF-Connecting-IP") ?? "unknown-network";
  const clientLimiter = ctx.env.ASSISTANT_CLIENT_RATE_LIMITER;
  const networkLimiter = ctx.env.ASSISTANT_NETWORK_RATE_LIMITER;

  if (!clientKey || !clientLimiter || !networkLimiter) {
    return "unavailable" as const;
  }

  try {
    const [client, network] = await Promise.all([
      clientLimiter.limit({ key: clientKey }),
      networkLimiter.limit({ key: networkKey }),
    ]);

    return client.success && network.success ? ("allowed" as const) : ("limited" as const);
  } catch {
    return "unavailable" as const;
  }
};

const isShowUiCommand = (message: string): boolean => message.trim().toLowerCase() === "show ui";

const isHideUiCommand = (message: string): boolean => message.trim().toLowerCase() === "hide ui";

const showUiResponse = (ctx: Context<AppEnv>, payload: AssistantTurnRequest): Response => {
  const visibleState = stateForVisibleUi(payload);

  return ctx.json(
    responseFor(visibleState, payload.draft, "Here is the interface for your current feed.", {
      ttlSelected: payload.ttlSelected,
      issues: payload.issues,
      showUi: true,
    }),
  );
};

const hideUiResponse = (ctx: Context<AppEnv>, payload: AssistantTurnRequest): Response => {
  if (canFinalizeDraft(payload)) {
    const feedUrl =
      payload.draft.source === "topics"
        ? createTopicFeedUrl(payload.draft, ctx.req.url)
        : createStarredFeedUrl(payload.draft, ctx.req.url);

    if (feedUrl === null) {
      return ctx.json({ error: "Invalid request" }, 400);
    }

    return ctx.json(
      responseFor("ready", payload.draft, "I've hidden the feed interface.", {
        ttlSelected: payload.ttlSelected,
        issues: payload.issues,
        feedUrl,
        showUi: false,
      }),
    );
  }

  return ctx.json(
    responseFor(payload.state, payload.draft, "I've hidden the feed interface.", {
      ttlSelected: payload.ttlSelected,
      issues: payload.issues,
      showUi: false,
    }),
  );
};

const featuredTopicMessage = async (githubLayer: AppEnv["Variables"]["githubLayer"]) => {
  const topics = await runEffect(
    Effect.flatMap(GitHubClient, (client) => client.getFeaturedTopics()).pipe(
      Effect.provide(githubLayer),
      Effect.timeout(GITHUB_LOOKUP_TIMEOUT),
    ),
  );
  const examples = topics.slice(0, 4).map((topic) => topic.display_name ?? topic.name);

  if (examples.length === 0) {
    return "Featured topics are temporarily unavailable. You can still specify any GitHub topic.";
  }

  return `Featured topics include ${examples.join(", ")}. You can also specify your own GitHub topics.`;
};

const validateTopics = async (
  draft: FeedDraft,
  githubLayer: AppEnv["Variables"]["githubLayer"],
): Promise<{ valid: string[]; invalid: string[] }> => {
  if (draft.topics.length > 5 || draft.topics.some((topic) => !TOPIC_SLUG.test(topic))) {
    return { valid: [], invalid: draft.topics };
  }

  const validations = await runEffect(
    Effect.flatMap(GitHubClient, (client) =>
      Effect.all(
        draft.topics.map((topic) => client.validateTopic(topic)),
        { concurrency: 5 },
      ),
    ).pipe(Effect.provide(githubLayer), Effect.timeout(GITHUB_LOOKUP_TIMEOUT)),
  );

  return {
    valid: draft.topics.filter((_, index) => validations[index]),
    invalid: draft.topics.filter((_, index) => !validations[index]),
  };
};

const informationalResponse = (
  ctx: Context<AppEnv>,
  payload: AssistantTurnRequest,
  message: string,
): Response => {
  if (payload.state === "ready") {
    const feedUrl =
      payload.draft.source === "topics"
        ? createTopicFeedUrl(payload.draft, ctx.req.url)
        : createStarredFeedUrl(payload.draft, ctx.req.url);

    if (feedUrl === null) {
      return ctx.json({ error: "Invalid request" }, 400);
    }

    return ctx.json(
      responseFor("ready", payload.draft, message, {
        ttlSelected: payload.ttlSelected,
        issues: payload.issues,
        feedUrl,
        showUi: true,
      }),
    );
  }

  return ctx.json(
    responseFor(payload.state, payload.draft, message, {
      ttlSelected: payload.ttlSelected,
      issues: payload.issues,
    }),
  );
};

const validateStarredRepos = async (
  username: string,
  repos: readonly string[],
  githubLayer: AppEnv["Variables"]["githubLayer"],
): Promise<{ valid: string[]; invalid: string[] }> => {
  const fetched = await runEffect(
    Effect.flatMap(GitHubClient, (client) => client.getStarredRepos(username)).pipe(
      Effect.provide(githubLayer),
      Effect.timeout(GITHUB_LOOKUP_TIMEOUT),
    ),
  );
  const available = new Set(fetched.map((repo) => repo.full_name));

  return {
    valid: repos.filter((repo) => available.has(repo)),
    invalid: repos.filter((repo) => !available.has(repo)),
  };
};

const handleStarredTurn = async (
  ctx: Context<AppEnv>,
  decision: ModelDecision,
  candidate: FeedDraft,
  candidateTtlSelected: boolean,
): Promise<Response> => {
  const { username, repoSelection } = candidate;

  if (username === null) {
    return ctx.json(
      responseFor(
        "enter-username",
        candidate,
        "Which GitHub username should I use? I need a username to build a starred-repository feed.",
        { ttlSelected: candidateTtlSelected },
      ),
    );
  }

  if (!USERNAME_PATTERN.test(username)) {
    const issue = `“${username}” is not a valid GitHub username.`;

    return ctx.json(
      responseFor("enter-username", candidate, "That doesn't look like a GitHub username.", {
        ttlSelected: candidateTtlSelected,
        issues: [issue],
      }),
    );
  }

  let validation: { exists: boolean; hasStars: boolean };

  try {
    validation = await runEffect(
      Effect.flatMap(GitHubClient, (client) => client.validateUsername(username)).pipe(
        Effect.provide(ctx.var.githubLayer),
        Effect.timeout(GITHUB_LOOKUP_TIMEOUT),
      ),
    );
  } catch {
    return ctx.json({ error: "Starred repository lookup temporarily unavailable" }, 503);
  }

  if (!validation.exists) {
    const issue = `No GitHub user found with the username “${username}”.`;

    return ctx.json(
      responseFor("enter-username", candidate, issue, {
        ttlSelected: candidateTtlSelected,
        issues: [issue],
      }),
    );
  }

  if (!validation.hasStars) {
    const issue = `@${username} has no public starred repositories.`;

    return ctx.json(
      responseFor("enter-username", candidate, issue, {
        ttlSelected: candidateTtlSelected,
        issues: [issue],
      }),
    );
  }

  if (decision.intent === "unsupported") {
    const unsupported = unsupportedDetails(decision, "starred");

    return ctx.json(
      responseFor(editableStateForDraft(candidate), candidate, unsupported.message, {
        ttlSelected: candidateTtlSelected,
        issues: [unsupported.issue],
      }),
    );
  }

  if (repoSelection === null) {
    return ctx.json(
      responseFor(
        "choose-repos",
        candidate,
        `Found @${username}. Do you want all of their starred repositories or a specific selection?`,
        { ttlSelected: candidateTtlSelected },
      ),
    );
  }

  if (repoSelection.kind === "all") {
    if (!candidateTtlSelected) {
      return ctx.json(
        responseFor(
          "edit-settings",
          candidate,
          `I'll include all of @${username}'s starred repositories. Next, choose how often the feed should update. I can show you the settings UI or list the available options.`,
          { ttlSelected: candidateTtlSelected },
        ),
      );
    }

    return ctx.json(
      responseFor("ready", candidate, "Your starred-repository feed is ready.", {
        ttlSelected: candidateTtlSelected,
        feedUrl: createStarredFeedUrl(candidate, ctx.req.url),
        showUi: true,
      }),
    );
  }

  let selection: { valid: string[]; invalid: string[] };

  try {
    selection = await validateStarredRepos(username, repoSelection.repos, ctx.var.githubLayer);
  } catch {
    return ctx.json({ error: "Starred repository lookup temporarily unavailable" }, 503);
  }

  const corrected: FeedDraft = {
    ...candidate,
    repoSelection: selection.valid.length > 0 ? { kind: "subset", repos: selection.valid } : null,
  };

  if (selection.invalid.length > 0) {
    const issues = selection.invalid.map(
      (repo) => `“${repo}” is not among @${username}'s starred repositories.`,
    );

    return ctx.json(
      responseFor("choose-repos", corrected, "Some repositories are not starred by this user.", {
        ttlSelected: candidateTtlSelected,
        issues,
      }),
    );
  }

  if (selection.valid.length === 0) {
    return ctx.json(
      responseFor(
        "choose-repos",
        corrected,
        `None of those repositories are among @${username}'s starred repositories. Do you want all of them or a specific selection?`,
        { ttlSelected: candidateTtlSelected },
      ),
    );
  }

  if (!candidateTtlSelected) {
    return ctx.json(
      responseFor(
        "edit-settings",
        corrected,
        selectionMessage(selection.valid, "repository", "repositories"),
        {
          ttlSelected: candidateTtlSelected,
        },
      ),
    );
  }

  return ctx.json(
    responseFor("ready", corrected, "Your starred-repository feed is ready.", {
      ttlSelected: candidateTtlSelected,
      feedUrl: createStarredFeedUrl(corrected, ctx.req.url),
      showUi: true,
    }),
  );
};

const handleRepoSelectionAction = async (
  ctx: Context<AppEnv>,
  decision: ModelDecision,
  candidate: FeedDraft,
  candidateTtlSelected: boolean,
): Promise<Response> => {
  const { repoSelectionAction } = decision;
  const { username } = candidate;

  if (
    decision.intent !== "create-or-update-feed" ||
    repoSelectionAction === undefined ||
    repoSelectionAction.kind !== "first" ||
    candidate.source !== "starred" ||
    username === null ||
    !USERNAME_PATTERN.test(username)
  ) {
    logAssistantFailure("repository-action-context", undefined, decision.intent);
    return ctx.json({ error: "Assistant response was invalid" }, 502);
  }

  let repoNames: string[];

  try {
    const repos = await runEffect(
      Effect.flatMap(GitHubClient, (client) => client.getStarredRepos(username)).pipe(
        Effect.provide(ctx.var.githubLayer),
        Effect.timeout(GITHUB_LOOKUP_TIMEOUT),
      ),
    );

    repoNames = repos.slice(0, repoSelectionAction.count).map((repo) => repo.full_name);
  } catch {
    return ctx.json({ error: "Starred repository lookup temporarily unavailable" }, 503);
  }

  if (repoNames.length === 0) {
    const issue = `@${username} has no public starred repositories.`;

    return ctx.json(
      responseFor("choose-repos", candidate, issue, {
        ttlSelected: candidateTtlSelected,
        issues: [issue],
        showUi: true,
      }),
    );
  }

  const selected: FeedDraft = {
    ...candidate,
    repoSelection: { kind: "subset", repos: repoNames },
  };

  if (candidateTtlSelected) {
    return ctx.json(
      responseFor("ready", selected, "Your starred-repository feed is ready.", {
        ttlSelected: candidateTtlSelected,
        feedUrl: createStarredFeedUrl(selected, ctx.req.url),
        showUi: true,
      }),
    );
  }

  return ctx.json(
    responseFor(
      "edit-settings",
      selected,
      selectionMessage(repoNames, "repository", "repositories"),
      {
        ttlSelected: candidateTtlSelected,
        showUi: true,
      },
    ),
  );
};

assistantRoutes.post("/turn", async (ctx) => {
  if (!(await evaluateAdaptiveFeedBuilder(ctx))) {
    return ctx.json({ error: "Not found" }, 404);
  }

  let payload: unknown;

  try {
    payload = await readBody(ctx.req.raw);
  } catch (error) {
    const status = error instanceof RangeError ? 413 : 400;

    return ctx.json({ error: status === 413 ? "Request too large" : "Invalid request" }, status);
  }

  if (!isAssistantTurnRequest(payload)) {
    return ctx.json({ error: "Invalid request" }, 400);
  }

  if (!isStateConsistentWithDraft(payload.state, payload.draft, payload.ttlSelected)) {
    return ctx.json({ error: "Invalid request" }, 400);
  }

  if (isShowUiCommand(payload.message)) {
    return showUiResponse(ctx, payload);
  }

  if (isHideUiCommand(payload.message)) {
    return hideUiResponse(ctx, payload);
  }

  const rateLimit = await checkRateLimits(ctx);

  if (rateLimit === "limited") {
    return ctx.json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  if (rateLimit === "unavailable") {
    return ctx.json({ error: "Assistant temporarily unavailable" }, 503);
  }

  if (!ctx.env.AI) {
    return ctx.json({ error: "Assistant temporarily unavailable" }, 503);
  }

  let decision: ModelDecision;

  try {
    const interpret: Interpreter = interpretWithLlama;

    decision = await interpret(
      { ...payload, requiredDecision: requiredDecisionFor(payload) },
      ctx.env,
      ctx.req.raw.signal,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return ctx.body(null, 408);
    }

    logAssistantFailure(
      error instanceof AssistantModelError ? "model-output" : "workers-ai",
      error,
    );
    return ctx.json({ error: "Assistant response was invalid" }, 502);
  }

  if (!isReadOnlyDecisionValid(decision)) {
    logAssistantFailure("read-only-mutation", undefined, decision.intent);
    return ctx.json({ error: "Assistant response was invalid" }, 502);
  }

  if (decision.intent === "show-ui") {
    return showUiResponse(ctx, payload);
  }

  if (decision.intent === "hide-ui") {
    return hideUiResponse(ctx, payload);
  }

  if (decision.intent === "list-repositories") {
    const { source, username } = payload.draft;

    if (source !== "starred" || username === null) {
      logAssistantFailure("repository-list-context", undefined, decision.intent);
      return ctx.json({ error: "Assistant response was invalid" }, 502);
    }

    return ctx.json(
      responseFor(
        "choose-repos",
        payload.draft,
        `Here are @${username}'s starred repositories. Choose specific repositories below, or include all of them.`,
        {
          ttlSelected: payload.ttlSelected,
          issues: payload.issues,
          showUi: true,
        },
      ),
    );
  }

  if (decision.intent === "list-settings") {
    return informationalResponse(ctx, payload, SETTINGS_OPTIONS_MESSAGE);
  }

  if (decision.intent === "list-topics") {
    try {
      return informationalResponse(ctx, payload, await featuredTopicMessage(ctx.var.githubLayer));
    } catch {
      return ctx.json({ error: "Topic discovery temporarily unavailable" }, 503);
    }
  }

  if (decision.intent === "explain-capabilities") {
    return informationalResponse(ctx, payload, CAPABILITIES_MESSAGE);
  }

  const normalizedModelPatch = normalizeModelPatch(decision.draftPatch);
  const requiredDecision = requiredDecisionFor(payload);
  const explicitRepositoryNames = extractExplicitRepositoryNames(payload.message);
  const currentRepositorySelection = payload.draft.repoSelection;
  let replacementRepositoryNames: string[] | null = null;

  if (decision.repoSelectionAction?.kind === "replace") {
    if (
      decision.intent !== "create-or-update-feed" ||
      payload.draft.source !== "starred" ||
      currentRepositorySelection?.kind !== "subset" ||
      normalizedModelPatch.repoSelection?.kind !== "subset"
    ) {
      logAssistantFailure("repository-action-context", undefined, decision.intent);
      return ctx.json({ error: "Assistant response was invalid" }, 502);
    }

    const allowedRepositoryNames = mergeRepositoryNames(
      currentRepositorySelection.repos,
      explicitRepositoryNames,
    );
    const allowedByKey = new Map(
      allowedRepositoryNames.map((repository) => [repository.toLowerCase(), repository]),
    );
    const trustedReplacement: string[] = [];

    for (const repository of normalizedModelPatch.repoSelection.repos) {
      const trustedRepository = allowedByKey.get(repository.toLowerCase());

      if (trustedRepository === undefined) {
        logAssistantFailure("repository-action-context", undefined, decision.intent);
        return ctx.json({ error: "Assistant response was invalid" }, 502);
      }

      trustedReplacement.push(trustedRepository);
    }

    replacementRepositoryNames = mergeRepositoryNames([], trustedReplacement);
  }

  const canApplyExplicitRepositoryNames =
    decision.intent === "create-or-update-feed" &&
    explicitRepositoryNames.length > 0 &&
    (normalizedModelPatch.source === "starred" || payload.draft.source === "starred");
  const recoveredRepositorySelection =
    canApplyExplicitRepositoryNames &&
    requiredDecision === "recovery" &&
    payload.state === "choose-repos" &&
    payload.draft.source === "starred" &&
    currentRepositorySelection?.kind === "subset"
      ? currentRepositorySelection
      : null;
  const repositoryNamesForPatch = replacementRepositoryNames
    ? replacementRepositoryNames
    : recoveredRepositorySelection
      ? mergeRepositoryNames(recoveredRepositorySelection.repos, explicitRepositoryNames)
      : explicitRepositoryNames;

  if (
    (replacementRepositoryNames || recoveredRepositorySelection) &&
    repositoryNamesForPatch.length > MAX_EXPLICIT_REPOSITORIES
  ) {
    const issue = `Choose no more than ${MAX_EXPLICIT_REPOSITORIES} repositories.`;

    return ctx.json(
      responseFor("choose-repos", payload.draft, issue, {
        ttlSelected: payload.ttlSelected,
        issues: [issue],
      }),
    );
  }

  // Deterministic owner/repo entities are authoritative even when the model omits
  // repoSelection; the intent and starred-source gates keep extraction in context.
  const shouldRetainExplicitRepositories =
    (replacementRepositoryNames !== null || canApplyExplicitRepositoryNames) &&
    repositoryNamesForPatch.length <= MAX_EXPLICIT_REPOSITORIES;
  const candidatePatch = shouldRetainExplicitRepositories
    ? {
        ...normalizedModelPatch,
        repoSelection: { kind: "subset" as const, repos: repositoryNamesForPatch },
      }
    : normalizedModelPatch;
  const candidate = applyDraftPatch(payload.draft, candidatePatch);
  const candidateTtlSelected = payload.ttlSelected || "ttl" in decision.draftPatch;
  const repositoryAction = shouldRetainExplicitRepositories
    ? undefined
    : decision.repoSelectionAction;
  const hasTrustedRepositoryContext =
    candidate.source === "starred" &&
    candidate.username !== null &&
    USERNAME_PATTERN.test(candidate.username);
  const canApplyRepoSelectionAction =
    decision.intent === "create-or-update-feed" &&
    repositoryAction !== undefined &&
    hasTrustedRepositoryContext &&
    (requiredDecision === "repository-selection" ||
      (repositoryAction.kind === "all" &&
        payload.draft.username !== null &&
        isRepoSelectionComplete(payload.draft.repoSelection)));

  if (canApplyRepoSelectionAction) {
    if (repositoryAction.kind === "all") {
      return handleStarredTurn(
        ctx,
        decision,
        { ...candidate, repoSelection: { kind: "all" } },
        candidateTtlSelected,
      );
    }

    return handleRepoSelectionAction(ctx, decision, candidate, candidateTtlSelected);
  }

  if (candidate.source === "starred") {
    return handleStarredTurn(ctx, decision, candidate, candidateTtlSelected);
  }

  if (decision.intent === "unsupported" && candidate.source !== "topics") {
    return ctx.json(
      responseFor("recoverable-error", candidate, "That request cannot be used to create a feed.", {
        ttlSelected: candidateTtlSelected,
        issues: ["Try describing a topic feed or a starred-repository feed."],
      }),
    );
  }

  if (candidate.source === null) {
    return ctx.json(
      responseFor(
        "choose-source",
        candidate,
        "Choose whether to build from GitHub topics or starred repositories.",
        { ttlSelected: candidateTtlSelected },
      ),
    );
  }

  if (candidate.topics.length === 0) {
    return ctx.json(
      responseFor("edit-topics", candidate, "Choose one or more GitHub topics for this feed.", {
        ttlSelected: candidateTtlSelected,
      }),
    );
  }

  let topicValidation: { valid: string[]; invalid: string[] };

  try {
    topicValidation = await validateTopics(candidate, ctx.var.githubLayer);
  } catch {
    return ctx.json({ error: "Topic validation temporarily unavailable" }, 503);
  }

  if (topicValidation.invalid.length > 0) {
    const validationIssue = topicValidation.invalid.some((topic) => !TOPIC_SLUG.test(topic))
      ? TOPIC_LIMIT_ISSUE
      : `Check: ${topicValidation.invalid.join(", ")}`;

    return ctx.json(
      responseFor(
        "edit-topics",
        { ...candidate, topics: topicValidation.valid },
        "Some topics could not be found on GitHub.",
        {
          ttlSelected: candidateTtlSelected,
          issues:
            decision.intent === "unsupported" && decision.unsupportedReason === "interval"
              ? [validationIssue, SETTINGS_ISSUE]
              : [validationIssue],
        },
      ),
    );
  }

  if (decision.intent === "unsupported") {
    const unsupported = unsupportedDetails(decision, "topics");

    return ctx.json(
      responseFor("edit-settings", candidate, unsupported.message, {
        ttlSelected: candidateTtlSelected,
        issues: [unsupported.issue],
      }),
    );
  }

  const needsExplicitTtl = !candidateTtlSelected;

  if (needsExplicitTtl) {
    return ctx.json(
      responseFor(
        "edit-settings",
        candidate,
        selectionMessage(candidate.topics, "topic", "topics"),
        {
          ttlSelected: candidateTtlSelected,
        },
      ),
    );
  }

  return ctx.json(
    responseFor("ready", candidate, "Your topic feed is ready.", {
      ttlSelected: candidateTtlSelected,
      feedUrl: createTopicFeedUrl(candidate, ctx.req.url),
      showUi: true,
    }),
  );
});
