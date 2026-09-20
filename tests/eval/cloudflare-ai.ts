import { isJevResponse, type JevResponse } from "../../worker/src/assistant/interpreter/jev/types";

// Minimal REST client for the offline evaluation. Request grammars verified
// against https://developers.cloudflare.com/ai/models/typesafe/jev/ and
// https://docs.typesafe.ai/api.

export const JEV_MODEL_ID = "typesafe/jev";
// The direct API accepts an exact version, so a run is reproducible.
export const TYPESAFE_MODEL_ID = "jev-1.13.0";

const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 2_000;
const MAX_REASON_LENGTH = 200;

export type CloudflareAiCredentials =
  | { transport: "cloudflare"; accountId: string; apiToken: string }
  | { transport: "typesafe"; apiToken: string };

export type JevRunInput = {
  state: object;
  questions: object;
};

export type JevRunResult = {
  response: JevResponse;
  latencyMs: number;
};

export type JevRunOptions = {
  fetch?: typeof fetch;
  // Called immediately before every HTTP request, retries included.
  onRequest?: () => void;
  allowRetry?: boolean;
  timeoutMs?: number;
  retryDelayMs?: number;
};

export class CloudflareAiError extends Error {
  override name = "CloudflareAiError";
  readonly status: number | null;

  constructor(status: number | null, reason: string) {
    super(`Jev request failed (status ${status ?? "none"}): ${reason}`);
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const failureReason = (body: unknown, fallback: string, apiToken: string): string => {
  const first = isRecord(body) && Array.isArray(body.errors) ? body.errors[0] : undefined;
  const reason = isRecord(first) && typeof first.message === "string" ? first.message : fallback;

  return reason.replaceAll(apiToken, "[redacted]").slice(0, MAX_REASON_LENGTH);
};

const isRetryable = (error: unknown): boolean =>
  error instanceof CloudflareAiError &&
  error.status !== null &&
  (error.status === 429 || error.status >= 500);

const wait = async (milliseconds: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, milliseconds);
    });
  } finally {
    clearTimeout(timer);
  }
};

const requestFor = (
  credentials: CloudflareAiCredentials,
  input: JevRunInput,
): { url: string; body: string } =>
  credentials.transport === "typesafe"
    ? {
        url: "https://api.typesafe.ai/v1/systemone",
        body: JSON.stringify({ model: TYPESAFE_MODEL_ID, ...input }),
      }
    : {
        url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/ai/run`,
        body: JSON.stringify({ model: JEV_MODEL_ID, input }),
      };

const attempt = async (
  credentials: CloudflareAiCredentials,
  input: JevRunInput,
  options: JevRunOptions,
): Promise<JevRunResult> => {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    options.onRequest?.();

    const request = requestFor(credentials, input);
    const startedAt = performance.now();
    const httpResponse = await (options.fetch ?? fetch)(request.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiToken}`,
        "Content-Type": "application/json",
      },
      body: request.body,
      signal: controller.signal,
    });
    const body = parseJson(await httpResponse.text());
    const latencyMs = performance.now() - startedAt;

    if (!httpResponse.ok) {
      throw new CloudflareAiError(
        httpResponse.status,
        failureReason(body, httpResponse.statusText || "request rejected", credentials.apiToken),
      );
    }

    // Undocumented whether REST wraps the model output in the usual envelope.
    const payload = isRecord(body) && isRecord(body.result) ? body.result : body;

    if (!isJevResponse(payload)) {
      throw new CloudflareAiError(
        httpResponse.status,
        failureReason(
          body,
          "response is not a Jev { model, answers } payload",
          credentials.apiToken,
        ),
      );
    }

    return { response: payload, latencyMs };
  } catch (error) {
    if (error instanceof CloudflareAiError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new CloudflareAiError(null, `timed out after ${timeoutMs}ms`);
    }

    throw new CloudflareAiError(
      null,
      failureReason(
        undefined,
        error instanceof Error ? error.name : "network error",
        credentials.apiToken,
      ),
    );
  } finally {
    clearTimeout(timer);
  }
};

export const runJev = async (
  credentials: CloudflareAiCredentials,
  input: JevRunInput,
  options: JevRunOptions = {},
): Promise<JevRunResult> => {
  try {
    return await attempt(credentials, input, options);
  } catch (error) {
    if (options.allowRetry === false || !isRetryable(error)) {
      throw error;
    }
  }

  await wait(options.retryDelayMs ?? RETRY_DELAY_MS);

  return attempt(credentials, input, options);
};
