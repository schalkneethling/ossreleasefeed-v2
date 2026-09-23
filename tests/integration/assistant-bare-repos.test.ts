import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../worker/src/index";
import {
  DEFAULT_FEED_DRAFT,
  type AssistantTurnRequest,
  type FeedDraft,
} from "../../worker/src/assistant/contracts";
import { bareRepositoryQuestionId } from "../../worker/src/assistant/interpreter/jev/bare-repos";
import { candidatesFor } from "../../worker/src/assistant/interpreter/jev/candidates";
import { buildJevQuestions } from "../../worker/src/assistant/interpreter/jev/questions";
import type { JevAnswer } from "../../worker/src/assistant/interpreter/jev/types";
import type { WorkerBindings } from "../../worker/src/lib/types";
import { server } from "./setup";

vi.mock("../../worker/src/lib/sentry", () => ({
  captureFeedError: vi.fn<(error: unknown) => void>(),
  sentryOptions: () => undefined,
}));

// Shortens the client's retry wait so a failing second request does not hold
// the test for the production delay.
vi.mock("../../worker/src/assistant/interpreter/jev/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../worker/src/assistant/interpreter/jev/client")>();
  const runJev: typeof original.runJev = (apiKey, input, signal, fetchImpl) =>
    original.runJev(apiKey, input, signal, fetchImpl, { retryDelayMs: 5 });

  return { ...original, runJev };
});

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-1.13.0";
const ADAPTIVE_FLAG = "adaptive-feed-builder";
const JEV_FLAG = "assistant-interpreter-jev";
const API_KEY = "test-typesafe-key";
const experimentKey = "test-experiment-key-1234";

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
} as ExecutionContext;

type AiRun = (
  model: string,
  input: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

const makeAssistantEnv = ({
  jevFlag = true,
  aiResponse = { intent: "create-or-update-feed", draftPatch: {} },
}: { jevFlag?: boolean; aiResponse?: unknown } = {}) => {
  const getBooleanValue = vi.fn<
    (flag: string, defaultValue: boolean, context: Record<string, string>) => Promise<boolean>
  >(async (flag) => flag === ADAPTIVE_FLAG || (flag === JEV_FLAG && jevFlag));
  const run = vi.fn<AiRun>(async () => ({ response: aiResponse }));
  const limit = async () => ({ success: true });
  const bindings: WorkerBindings = {
    APP_NAME: "ossreleasefeed",
    GITHUB_PAT: "test-token",
    TYPESAFE_API_KEY: API_KEY,
    FLAGS: { getBooleanValue } as unknown as Flagship,
    AI: { run },
    ASSISTANT_CLIENT_RATE_LIMITER: { limit },
    ASSISTANT_NETWORK_RATE_LIMITER: { limit },
  };

  return { bindings, run };
};

const starredDraft: FeedDraft = {
  ...DEFAULT_FEED_DRAFT,
  source: "starred",
  username: "octocat",
  repoSelection: null,
};

const starredTurn = (
  message: string,
  overrides: Partial<AssistantTurnRequest> = {},
): AssistantTurnRequest => ({
  message,
  state: "choose-repos",
  draft: starredDraft,
  issues: [],
  ttlSelected: false,
  ...overrides,
});

const postAssistant = (body: unknown, bindings: WorkerBindings, signal?: AbortSignal) =>
  app.fetch(
    new Request("http://127.0.0.1:8787/api/assistant/turn", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
        "X-Experiment-Key": experimentKey,
      },
      body: JSON.stringify(body),
      signal,
    }),
    bindings,
    executionContext,
  );

const noul = (probability: number): JevAnswer => ({ type: "noul", noul: probability });

const choice = (label: string, confidence: number): JevAnswer => ({
  type: "choice",
  choice: label,
  confidence,
  probabilities: { [label]: confidence },
});

// Every question of the turn's own request answered "not stated", so the
// interpreter leaves the repository selection open.
const turnAnswers = (
  message: string,
  draft: FeedDraft = starredDraft,
  overrides: Record<string, JevAnswer> = {},
): Record<string, JevAnswer> => {
  const questions = buildJevQuestions(draft, candidatesFor(message, draft.topics));
  const answers: Record<string, JevAnswer> = {};

  for (const [id, question] of Object.entries(questions)) {
    const [firstLabel = ""] = Object.keys(question.criteria);

    answers[id] = question.type === "noul" ? noul(0.02) : choice(firstLabel, 0.2);
  }

  answers.intent = choice("create-or-update-feed", 0.95);

  return { ...answers, ...overrides };
};

const jevBody = (answers: Record<string, JevAnswer>) => ({
  model: JEV_MODEL,
  answers,
  usage: { input_tokens: 800, output_tokens: 20 },
});

type CapturedRequest = { body: Record<string, unknown> };

const useTypeSafe = (...responses: Array<() => Response | Promise<Response>>) => {
  const requests: CapturedRequest[] = [];

  server.use(
    http.post(TYPESAFE_URL, async ({ request }) => {
      requests.push({ body: (await request.json()) as Record<string, unknown> });

      const respond = responses[Math.min(requests.length, responses.length) - 1];

      if (!respond) {
        throw new Error("no TypeSafe response configured");
      }

      return respond();
    }),
  );

  return requests;
};

const starredRepo = (fullName: string) => {
  const [owner = "", name = ""] = fullName.split("/");

  return {
    full_name: fullName,
    name,
    description: null,
    stargazers_count: 1,
    owner: { login: owner },
  };
};

const STARRED = [
  "facebook/react",
  "vitejs/vite",
  "remix-run/react-router",
  "vitest-dev/vitest",
  "vercel/next.js",
];

const useOctocatStars = (fullNames: readonly string[] = STARRED) => {
  server.use(
    http.get("https://api.github.com/users/octocat", () => HttpResponse.json({ login: "octocat" })),
    http.get("https://api.github.com/users/octocat/starred", () =>
      HttpResponse.json(fullNames.map(starredRepo)),
    ),
  );
};

describe("POST /api/assistant/turn bare repository names", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects exact, one-to-one bare names in code with only the turn's own request", async () => {
    // No other starred name contains "react" or "vite", so code settles both.
    useOctocatStars(["facebook/react", "vitejs/vite", "vercel/next.js"]);
    const message = "just react and vite";
    const requests = useTypeSafe(() => HttpResponse.json(jevBody(turnAnswers(message))));
    const { bindings, run } = makeAssistantEnv();
    const response = await postAssistant(starredTurn(message), bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "edit-settings",
      draft: {
        source: "starred",
        username: "octocat",
        repoSelection: { kind: "subset", repos: ["facebook/react", "vitejs/vite"] },
      },
      message: expect.stringContaining(
        "I selected 2 repositories: facebook/react, and vitejs/vite.",
      ),
      issues: [],
      feedUrl: null,
    });
    expect(requests).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("asks Jev once, with one Noul per candidate, when a bare name fits several repositories", async () => {
    useOctocatStars();
    const message = "react";
    const requests = useTypeSafe(
      () => HttpResponse.json(jevBody(turnAnswers(message))),
      () =>
        HttpResponse.json(
          jevBody({
            [bareRepositoryQuestionId(0)]: noul(0.93),
            [bareRepositoryQuestionId(1)]: noul(0.12),
          }),
        ),
    );
    const { bindings } = makeAssistantEnv();
    const response = await postAssistant(starredTurn(message), bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "edit-settings",
      draft: { repoSelection: { kind: "subset", repos: ["facebook/react"] } },
      message: expect.stringContaining("I selected the repository facebook/react."),
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body.model).toBe(JEV_MODEL);
    expect(requests[1]?.body.state).toEqual({
      user_message: { text: message },
      starred_candidates: [
        { id: 0, full_name: "facebook/react" },
        { id: 1, full_name: "remix-run/react-router" },
      ],
    });
    expect(Object.keys(requests[1]?.body.questions as object)).toEqual([
      bareRepositoryQuestionId(0),
      bareRepositoryQuestionId(1),
    ]);
    expect(JSON.stringify(requests[1]?.body)).not.toMatch(/feed_so_far|app_just_asked/u);
  });

  it("asks the person, offering the list first, when the second request fails", async () => {
    useOctocatStars();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const message = "react";
    const requests = useTypeSafe(
      () => HttpResponse.json(jevBody(turnAnswers(message))),
      () => HttpResponse.json({ error: `upstream echoed ${message}` }, { status: 500 }),
    );
    const { bindings } = makeAssistantEnv();
    const response = await postAssistant(starredTurn(message), bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "choose-repos",
      draft: starredDraft,
      message:
        "Found @octocat. Do you want all of their starred repositories or a specific selection?",
      suggestions: ["Show me the repositories", "Include all of them", "Select the first 10"],
    });
    // The turn's request, then the second request and its one retry.
    expect(requests).toHaveLength(3);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "assistant_turn_failure",
      stage: "typesafe-repositories",
      model: JEV_MODEL,
      intent: "create-or-update-feed",
      errorName: "JevClientError",
      errorKind: "http",
      errorStatus: 500,
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("react");
  });

  it("asks the person without a hint when Jev judges that no candidate was asked for", async () => {
    useOctocatStars();
    const message = "react";

    useTypeSafe(
      () => HttpResponse.json(jevBody(turnAnswers(message))),
      () =>
        HttpResponse.json(
          jevBody({
            [bareRepositoryQuestionId(0)]: noul(0.2),
            [bareRepositoryQuestionId(1)]: noul(0.1),
          }),
        ),
    );

    const { bindings } = makeAssistantEnv();
    const response = await postAssistant(starredTurn(message), bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "choose-repos",
      suggestions: ["Include all of them", "Select the first 10", "Show me the repositories"],
    });
  });

  it("returns 408 when the caller aborts during the second request", async () => {
    useOctocatStars();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const caller = new AbortController();
    const message = "react";
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = useTypeSafe(
      () => HttpResponse.json(jevBody(turnAnswers(message))),
      async () => {
        caller.abort();
        await held;

        return HttpResponse.json(jevBody({}));
      },
    );

    try {
      const { bindings } = makeAssistantEnv();
      const response = await postAssistant(starredTurn(message), bindings, caller.signal);

      expect(response.status).toBe(408);
      expect(requests).toHaveLength(2);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it("leaves an explicit owner/repo to the explicit path and never counts it twice", async () => {
    useOctocatStars();
    const message = "facebook/react and react";
    const requests = useTypeSafe(() => HttpResponse.json(jevBody(turnAnswers(message))));
    const { bindings } = makeAssistantEnv();
    const response = await postAssistant(starredTurn(message), bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "edit-settings",
      draft: { repoSelection: { kind: "subset", repos: ["facebook/react"] } },
    });
    expect(requests).toHaveLength(1);
  });

  it("adds bare names to an existing subset, or replaces it when the message restricts the feed", async () => {
    useOctocatStars();
    const draft: FeedDraft = {
      ...starredDraft,
      repoSelection: { kind: "subset", repos: ["vitest-dev/vitest"] },
    };
    const added = "add vite";
    const restricted = "only vite";
    const requests = useTypeSafe(
      () => HttpResponse.json(jevBody(turnAnswers(added, draft))),
      () =>
        HttpResponse.json(
          jevBody(turnAnswers(restricted, draft, { replaces_selection: noul(0.95) })),
        ),
    );
    const { bindings } = makeAssistantEnv();
    const addedResponse = await postAssistant(
      starredTurn(added, { state: "edit-settings", draft }),
      bindings,
    );
    const restrictedResponse = await postAssistant(
      starredTurn(restricted, { state: "edit-settings", draft }),
      bindings,
    );

    await expect(addedResponse.json()).resolves.toMatchObject({
      draft: { repoSelection: { kind: "subset", repos: ["vitest-dev/vitest", "vitejs/vite"] } },
    });
    await expect(restrictedResponse.json()).resolves.toMatchObject({
      draft: { repoSelection: { kind: "subset", repos: ["vitejs/vite"] } },
    });
    expect(requests).toHaveLength(2);
  });

  it("keeps the 25-repository cap", async () => {
    const starred = Array.from({ length: 30 }, (_, index) => `owner/lib${index}`);
    const message = starred
      .slice(0, 26)
      .map((name) => name.slice("owner/".length))
      .join(", ");

    useOctocatStars(starred);
    useTypeSafe(() => HttpResponse.json(jevBody(turnAnswers(message))));

    const { bindings } = makeAssistantEnv();
    const response = await postAssistant(starredTurn(message), bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "choose-repos",
      draft: starredDraft,
      issues: ["Choose no more than 25 repositories."],
    });
  });

  it("matches in code on the Llama path and never calls TypeSafe, asking when ambiguous", async () => {
    useOctocatStars();
    const requests = useTypeSafe(() => HttpResponse.json(jevBody({})));
    const { bindings, run } = makeAssistantEnv({ jevFlag: false });
    const settled = await postAssistant(starredTurn("just vitest and vite"), bindings);
    const ambiguous = await postAssistant(starredTurn("react"), bindings);

    expect(settled.status).toBe(200);
    await expect(settled.json()).resolves.toMatchObject({
      state: "edit-settings",
      draft: { repoSelection: { kind: "subset", repos: ["vitest-dev/vitest", "vitejs/vite"] } },
    });
    expect(ambiguous.status).toBe(200);
    await expect(ambiguous.json()).resolves.toMatchObject({
      state: "choose-repos",
      draft: starredDraft,
      suggestions: ["Show me the repositories", "Include all of them", "Select the first 10"],
    });
    expect(requests).toHaveLength(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not run bare matching for a suggested-reply turn or an all action", async () => {
    useOctocatStars();
    const requests = useTypeSafe(() =>
      HttpResponse.json(
        jevBody(
          turnAnswers("every one of them, react too", starredDraft, {
            wants_all_starred: noul(0.95),
          }),
        ),
      ),
    );
    const { bindings } = makeAssistantEnv();
    const chip = await postAssistant(starredTurn("Include all of them"), bindings);
    const all = await postAssistant(starredTurn("every one of them, react too"), bindings);

    await expect(chip.json()).resolves.toMatchObject({
      draft: { repoSelection: { kind: "all" } },
    });
    await expect(all.json()).resolves.toMatchObject({
      draft: { repoSelection: { kind: "all" } },
    });
    expect(requests).toHaveLength(1);
  });
});
