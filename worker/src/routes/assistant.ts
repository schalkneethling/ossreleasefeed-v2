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
import {
  bareRepositoryMatches,
  resolveBareRepositories,
} from "../assistant/interpreter/jev/bare-repos";
import { JEV_MODEL, JevClientError } from "../assistant/interpreter/jev/client";
import { INTENT_CLARIFY_THRESHOLD } from "../assistant/interpreter/jev/compose";
import { interpretWithJev, judgeBareRepositories } from "../assistant/interpreter/jev/index";
import { AssistantModelError, type Interpretation } from "../assistant/interpreter/types";
import {
  CAPABILITIES_MESSAGE,
  SETTINGS_ISSUE,
  SETTINGS_OPTIONS_MESSAGE,
  SUGGEST_LIST_REPOSITORIES,
  TOPIC_LIMIT_ISSUE,
  canFinalizeDraft,
  cannedDecisionFor,
  createStarredFeedUrl,
  createTopicFeedUrl,
  mergeRepositoryNames,
  promptFor,
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

export const ASSISTANT_INTERPRETER_HEADER = "X-Assistant-Interpreter";

const MAX_BODY_BYTES = 8_192;
// Conversation history is presentation-only client state and is not accepted
// by this route or forwarded to the model. The validated draft and derived
// required decision carry authoritative workflow context.
// GitHub lookups in the assistant request path are bounded so a slow or hung
// upstream response cannot hold the turn open; a deadline reaches the same
// 503 response as a lookup failure.
const GITHUB_LOOKUP_TIMEOUT = Duration.seconds(10);

type AssistantFailureStage =
  | "typesafe"
  | "model-output"
  | "repository-list-context"
  // The second Jev request, judging bare repository names, failed; the turn
  // still answers by asking the person to choose.
  | "typesafe-repositories";

const errorProperty = (error: unknown, property: string): string | number | undefined => {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return undefined;
  }

  const value: unknown = Reflect.get(error, property);

  return typeof value === "string" || typeof value === "number" ? value : undefined;
};

// Recorded for diagnostics when a suggested reply is answered without inference.
const CANNED_MODEL = "canned-suggestion";

const logAssistantFailure = (
  ctx: Context<AppEnv>,
  stage: AssistantFailureStage,
  error?: unknown,
  intent?: ModelDecision["intent"],
): void => {
  // oxlint-disable-next-line no-console -- Structured Worker diagnostics are the intended output.
  console.error({
    event: "assistant_turn_failure",
    stage,
    // What handled this turn: the Jev model id, or the canned-suggestion path.
    model: ctx.var.assistantModel ?? JEV_MODEL,
    ...(intent === undefined ? {} : { intent }),
    // A Jev client failure reports its kind and status only.
    ...(error instanceof JevClientError
      ? { errorName: error.name, errorKind: error.kind }
      : error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : {}),
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

// Interpreter hints reach the response through a `hints` parameter on every
// response builder below; nothing about a turn is held at module level.
const showUiResponse = (
  ctx: Context<AppEnv>,
  payload: AssistantTurnRequest,
  hints: readonly string[] = [],
): Response => {
  const visibleState = stateForVisibleUi(payload);

  return ctx.json(
    responseFor(visibleState, payload.draft, "Here is the interface for your current feed.", {
      ttlSelected: payload.ttlSelected,
      issues: payload.issues,
      showUi: true,
      hints,
    }),
  );
};

const hideUiResponse = (
  ctx: Context<AppEnv>,
  payload: AssistantTurnRequest,
  hints: readonly string[] = [],
): Response => {
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
        hints,
      }),
    );
  }

  return ctx.json(
    responseFor(payload.state, payload.draft, "I've hidden the feed interface.", {
      ttlSelected: payload.ttlSelected,
      issues: payload.issues,
      showUi: false,
      hints,
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
  hints: readonly string[] = [],
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
        hints,
      }),
    );
  }

  return ctx.json(
    responseFor(payload.state, payload.draft, message, {
      ttlSelected: payload.ttlSelected,
      issues: payload.issues,
      hints,
    }),
  );
};

const fetchStarredRepositoryNames = async (
  username: string,
  githubLayer: AppEnv["Variables"]["githubLayer"],
): Promise<string[]> => {
  const fetched = await runEffect(
    Effect.flatMap(GitHubClient, (client) => client.getStarredRepos(username)).pipe(
      Effect.provide(githubLayer),
      Effect.timeout(GITHUB_LOOKUP_TIMEOUT),
    ),
  );

  return fetched.map((repo) => repo.full_name);
};

const validateStarredRepos = (
  repos: readonly string[],
  starred: readonly string[],
): { valid: string[]; invalid: string[] } => {
  const available = new Set(starred);

  return {
    valid: repos.filter((repo) => available.has(repo)),
    invalid: repos.filter((repo) => !available.has(repo)),
  };
};

// What the bare-name path needs from the turn: set only when the interpreter
// left the repository selection open (no explicit subset, no all/first action).
type BareRepositoryContext = {
  message: string;
  replacesSelection: boolean;
  // The key the turn's own request already used; Jev may be asked once more
  // to settle an ambiguous match.
  apiKey: string;
};

type BareRepositoryOutcome =
  | { kind: "none" }
  | { kind: "selected"; repos: string[] }
  // Matching found candidates but no repository was settled; the turn asks
  // the person, offering the repository list first when the Jev request failed.
  | { kind: "ask"; suggestList: boolean }
  | { kind: "aborted" };

const bareRepositoryOutcome = async (
  ctx: Context<AppEnv>,
  bare: BareRepositoryContext,
  username: string,
  starred: readonly string[],
  intent: ModelDecision["intent"],
): Promise<BareRepositoryOutcome> => {
  const resolution = resolveBareRepositories(
    bareRepositoryMatches(bare.message, starred, { username }),
  );

  if (resolution === null) {
    return { kind: "none" };
  }

  if (resolution.kind === "resolved") {
    return { kind: "selected", repos: resolution.repos };
  }

  try {
    const repos = await judgeBareRepositories(
      bare.apiKey,
      bare.message,
      resolution.candidates,
      ctx.req.raw.signal,
    );

    return repos.length > 0 ? { kind: "selected", repos } : { kind: "ask", suggestList: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { kind: "aborted" };
    }

    logAssistantFailure(ctx, "typesafe-repositories", error, intent);

    return { kind: "ask", suggestList: true };
  }
};

const handleStarredTurn = async (
  ctx: Context<AppEnv>,
  decision: ModelDecision,
  candidate: FeedDraft,
  candidateTtlSelected: boolean,
  hints: readonly string[],
  bare: BareRepositoryContext | null = null,
): Promise<Response> => {
  const { username } = candidate;

  if (username === null) {
    return ctx.json(
      responseFor(
        "enter-username",
        candidate,
        "Which GitHub username should I use? I need a username to build a starred-repository feed.",
        { ttlSelected: candidateTtlSelected, hints },
      ),
    );
  }

  if (!USERNAME_PATTERN.test(username)) {
    const issue = `“${username}” is not a valid GitHub username.`;

    return ctx.json(
      responseFor("enter-username", candidate, "That doesn't look like a GitHub username.", {
        ttlSelected: candidateTtlSelected,
        hints,
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
        hints,
        issues: [issue],
      }),
    );
  }

  if (!validation.hasStars) {
    const issue = `@${username} has no public starred repositories.`;

    return ctx.json(
      responseFor("enter-username", candidate, issue, {
        ttlSelected: candidateTtlSelected,
        hints,
        issues: [issue],
      }),
    );
  }

  if (decision.intent === "unsupported") {
    const unsupported = unsupportedDetails(decision, "starred");

    return ctx.json(
      responseFor(editableStateForDraft(candidate), candidate, unsupported.message, {
        ttlSelected: candidateTtlSelected,
        hints,
        issues: [unsupported.issue],
      }),
    );
  }

  const askForSelection = (draft: FeedDraft, suggestList: boolean): Response =>
    ctx.json(
      responseFor(
        "choose-repos",
        draft,
        `Found @${username}. Do you want all of their starred repositories or a specific selection?`,
        {
          ttlSelected: candidateTtlSelected,
          hints: suggestList ? [SUGGEST_LIST_REPOSITORIES, ...hints] : hints,
        },
      ),
    );
  // Bare names apply to an open or subset selection; with "all" only when the
  // message restricts the feed to the names it gives.
  const bareApplies =
    bare !== null &&
    decision.intent === "create-or-update-feed" &&
    (candidate.repoSelection?.kind !== "all" || bare.replacesSelection);
  let starred: string[] | null = null;

  if (bareApplies || candidate.repoSelection?.kind === "subset") {
    try {
      starred = await fetchStarredRepositoryNames(username, ctx.var.githubLayer);
    } catch {
      return ctx.json({ error: "Starred repository lookup temporarily unavailable" }, 503);
    }
  }

  let repoSelection = candidate.repoSelection;

  if (bare !== null && bareApplies && starred !== null) {
    const outcome = await bareRepositoryOutcome(ctx, bare, username, starred, decision.intent);

    if (outcome.kind === "aborted") {
      return ctx.body(null, 408);
    }

    if (outcome.kind === "ask") {
      return askForSelection(candidate, outcome.suggestList);
    }

    if (outcome.kind === "selected") {
      // The same rules as explicit names: a restriction replaces the subset,
      // anything else adds to it.
      const existing =
        repoSelection?.kind === "subset" && !bare.replacesSelection ? repoSelection.repos : [];
      const repos = mergeRepositoryNames(existing, outcome.repos);

      if (repos.length > MAX_EXPLICIT_REPOSITORIES) {
        const issue = `Choose no more than ${MAX_EXPLICIT_REPOSITORIES} repositories.`;

        return ctx.json(
          responseFor("choose-repos", candidate, issue, {
            ttlSelected: candidateTtlSelected,
            issues: [issue],
            hints,
          }),
        );
      }

      repoSelection = { kind: "subset", repos };
    }
  }

  if (repoSelection === null) {
    return askForSelection(candidate, false);
  }

  if (repoSelection.kind === "all") {
    if (!candidateTtlSelected) {
      return ctx.json(
        responseFor(
          "edit-settings",
          candidate,
          `I'll include all of @${username}'s starred repositories. Next, choose how often the feed should update. I can show you the settings UI or list the available options.`,
          { ttlSelected: candidateTtlSelected, hints },
        ),
      );
    }

    return ctx.json(
      responseFor("ready", candidate, "Your starred-repository feed is ready.", {
        ttlSelected: candidateTtlSelected,
        hints,
        feedUrl: createStarredFeedUrl(candidate, ctx.req.url),
        showUi: true,
      }),
    );
  }

  // A subset here came from the draft or from the bare names, and the starred
  // list was fetched for either; an empty fallback fails closed to "invalid".
  const selection = validateStarredRepos(repoSelection.repos, starred ?? []);
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
        hints,
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
        { ttlSelected: candidateTtlSelected, hints },
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
          hints,
        },
      ),
    );
  }

  return ctx.json(
    responseFor("ready", corrected, "Your starred-repository feed is ready.", {
      ttlSelected: candidateTtlSelected,
      hints,
      feedUrl: createStarredFeedUrl(corrected, ctx.req.url),
      showUi: true,
    }),
  );
};

// Selects the first `count` repositories in trusted GitHub order. The caller
// has already established a starred candidate with a valid username.
const handleFirstRepositories = async (
  ctx: Context<AppEnv>,
  candidate: FeedDraft,
  username: string,
  count: number,
  candidateTtlSelected: boolean,
  hints: readonly string[],
): Promise<Response> => {
  let repoNames: string[];

  try {
    const repos = await runEffect(
      Effect.flatMap(GitHubClient, (client) => client.getStarredRepos(username)).pipe(
        Effect.provide(ctx.var.githubLayer),
        Effect.timeout(GITHUB_LOOKUP_TIMEOUT),
      ),
    );

    repoNames = repos.slice(0, count).map((repo) => repo.full_name);
  } catch {
    return ctx.json({ error: "Starred repository lookup temporarily unavailable" }, 503);
  }

  if (repoNames.length === 0) {
    const issue = `@${username} has no public starred repositories.`;

    return ctx.json(
      responseFor("choose-repos", candidate, issue, {
        ttlSelected: candidateTtlSelected,
        hints,
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
        hints,
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
        hints,
        showUi: true,
      },
    ),
  );
};

// Names what handled the turn (a model id, or the canned-suggestion path) so a
// flag or key problem is visible in the network panel. It never carries content.
assistantRoutes.use("/turn", async (ctx, next) => {
  await next();

  const interpreter = ctx.var.assistantModel;

  if (interpreter !== undefined) {
    ctx.res.headers.set(ASSISTANT_INTERPRETER_HEADER, interpreter);
  }
});

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

  const requiredDecision = requiredDecisionFor(payload);
  // A suggested reply offered at this required decision has a fixed meaning,
  // so it needs neither the interpreter nor the TypeSafe key. The rate limits
  // above still apply because several of these decisions call GitHub.
  const cannedDecision = cannedDecisionFor(payload.message, requiredDecision);
  // Local development passes an empty variable when the key is not configured.
  const apiKey = (ctx.env.TYPESAFE_API_KEY ?? "").trim();
  let interpretation: Interpretation;

  if (cannedDecision !== null) {
    ctx.set("assistantModel", CANNED_MODEL);
    interpretation = {
      decision: cannedDecision,
      hints: [],
      confidence: null,
      intentConfidence: null,
      replacesSelection: false,
    };
  } else {
    ctx.set("assistantModel", JEV_MODEL);

    if (apiKey === "") {
      return ctx.json({ error: "Assistant temporarily unavailable" }, 503);
    }

    try {
      interpretation = await interpretWithJev(
        { ...payload, requiredDecision },
        ctx.env,
        ctx.req.raw.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return ctx.body(null, 408);
      }

      logAssistantFailure(
        ctx,
        error instanceof AssistantModelError ? "model-output" : "typesafe",
        error,
      );
      return ctx.json({ error: "Assistant response was invalid" }, 502);
    }
  }

  const { decision, hints } = interpretation;
  // A discarded or unsupported request already changes nothing and asks for a
  // rephrase, so it keeps its own reply (an injection discard wins over this).
  const isRejectedRequest =
    decision.intent === "unsupported" && decision.unsupportedReason === "request";

  if (
    interpretation.intentConfidence !== null &&
    interpretation.intentConfidence < INTENT_CLARIFY_THRESHOLD &&
    !isRejectedRequest
  ) {
    // Too unsure of what was asked to act on it: change nothing and ask again.
    return informationalResponse(
      ctx,
      payload,
      `I didn't quite catch that. ${promptFor(requiredDecision)}`,
    );
  }

  if (decision.intent === "show-ui") {
    return showUiResponse(ctx, payload, hints);
  }

  if (decision.intent === "hide-ui") {
    return hideUiResponse(ctx, payload, hints);
  }

  if (decision.intent === "list-repositories") {
    const { source, username } = payload.draft;

    // Jev judges the message, not the draft: it can read "show me the repos"
    // as list-repositories while no starred username exists to list from.
    if (source !== "starred" || username === null) {
      logAssistantFailure(ctx, "repository-list-context", undefined, decision.intent);
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
          hints,
        },
      ),
    );
  }

  if (decision.intent === "list-settings") {
    return informationalResponse(ctx, payload, SETTINGS_OPTIONS_MESSAGE, hints);
  }

  if (decision.intent === "list-topics") {
    try {
      return informationalResponse(
        ctx,
        payload,
        await featuredTopicMessage(ctx.var.githubLayer),
        hints,
      );
    } catch {
      return ctx.json({ error: "Topic discovery temporarily unavailable" }, 503);
    }
  }

  if (decision.intent === "explain-capabilities") {
    return informationalResponse(ctx, payload, CAPABILITIES_MESSAGE, hints);
  }

  const modelPatch = decision.draftPatch;
  const explicitRepositoryNames = extractExplicitRepositoryNames(payload.message);
  const currentRepositorySelection = payload.draft.repoSelection;
  let replacementRepositoryNames: string[] | null = null;

  // A replace action is composed only for a create-or-update-feed decision
  // whose subset is the message's own explicit owner/repo names, over a draft
  // that already holds a subset (and so, by the consistency check, is starred).
  if (
    decision.repoSelectionAction?.kind === "replace" &&
    modelPatch.repoSelection?.kind === "subset"
  ) {
    // Starred validation compares names exactly, so a repository the draft
    // already holds keeps the casing GitHub reported rather than the typed one.
    const currentByKey = new Map(
      (currentRepositorySelection?.kind === "subset" ? currentRepositorySelection.repos : []).map(
        (repository) => [repository.toLowerCase(), repository],
      ),
    );

    replacementRepositoryNames = mergeRepositoryNames(
      [],
      modelPatch.repoSelection.repos.map(
        (repository) => currentByKey.get(repository.toLowerCase()) ?? repository,
      ),
    );
  }

  const canApplyExplicitRepositoryNames =
    decision.intent === "create-or-update-feed" &&
    explicitRepositoryNames.length > 0 &&
    (modelPatch.source === "starred" || payload.draft.source === "starred");
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
        hints,
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
        ...modelPatch,
        repoSelection: { kind: "subset" as const, repos: repositoryNamesForPatch },
      }
    : modelPatch;
  const candidate = applyDraftPatch(payload.draft, candidatePatch);
  const candidateTtlSelected = payload.ttlSelected || "ttl" in decision.draftPatch;
  // A replace action always retains its explicit names above, so only the
  // all and first actions can remain to apply here.
  const repositoryAction = shouldRetainExplicitRepositories
    ? undefined
    : decision.repoSelectionAction;
  const applicableRepositoryAction =
    decision.intent === "create-or-update-feed" &&
    repositoryAction !== undefined &&
    candidate.source === "starred" &&
    candidate.username !== null &&
    USERNAME_PATTERN.test(candidate.username) &&
    (requiredDecision === "repository-selection" ||
      (repositoryAction.kind === "all" &&
        payload.draft.username !== null &&
        isRepoSelectionComplete(payload.draft.repoSelection)))
      ? { action: repositoryAction, username: candidate.username }
      : null;

  if (applicableRepositoryAction !== null) {
    const { action, username } = applicableRepositoryAction;

    if (action.kind === "all") {
      return handleStarredTurn(
        ctx,
        decision,
        { ...candidate, repoSelection: { kind: "all" } },
        candidateTtlSelected,
        hints,
      );
    }

    if (action.kind === "first") {
      return handleFirstRepositories(
        ctx,
        candidate,
        username,
        action.count,
        candidateTtlSelected,
        hints,
      );
    }
  }

  if (candidate.source === "starred") {
    // Bare repository names ("just react and vite") are matched against the
    // starred list only when the interpreter left the selection open: no
    // explicit owner/repo subset and no all/first action. A chip's meaning is
    // fixed, so a canned turn never carries one.
    const bare: BareRepositoryContext | null =
      cannedDecision === null &&
      decision.intent === "create-or-update-feed" &&
      explicitRepositoryNames.length === 0 &&
      modelPatch.repoSelection?.kind !== "subset" &&
      decision.repoSelectionAction === undefined
        ? {
            message: payload.message,
            replacesSelection: interpretation.replacesSelection,
            apiKey,
          }
        : null;

    return handleStarredTurn(ctx, decision, candidate, candidateTtlSelected, hints, bare);
  }

  if (decision.intent === "unsupported" && candidate.source !== "topics") {
    return ctx.json(
      responseFor("recoverable-error", candidate, "That request cannot be used to create a feed.", {
        ttlSelected: candidateTtlSelected,
        hints,
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
        { ttlSelected: candidateTtlSelected, hints },
      ),
    );
  }

  if (candidate.topics.length === 0) {
    return ctx.json(
      responseFor("edit-topics", candidate, "Choose one or more GitHub topics for this feed.", {
        ttlSelected: candidateTtlSelected,
        hints,
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
          hints,
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
        hints,
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
          hints,
        },
      ),
    );
  }

  return ctx.json(
    responseFor("ready", candidate, "Your topic feed is ready.", {
      ttlSelected: candidateTtlSelected,
      hints,
      feedUrl: createTopicFeedUrl(candidate, ctx.req.url),
      showUi: true,
    }),
  );
});
