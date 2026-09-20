import { isJevResponse, type JevResponse } from "./types";

// Direct TypeSafe API client. Request grammar verified against
// https://docs.typesafe.ai/api. The direct API accepts an exact model version,
// so interpretation is pinned rather than following a moving alias.

const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export const JEV_MODEL = "jev-1.13.0";
export const EXPECTED_JEV_MODEL = JEV_MODEL;
// One budget for the whole call: both attempts and the wait between them.
export const JEV_TIMEOUT_MS = 4_000;
export const JEV_RETRY_DELAY_MS = 250;

export type JevClientErrorKind = "timeout" | "http" | "invalid-response" | "network";

// Messages are fixed tokens. The API key, request body, and response body must
// never reach an error message, because error details are logged.
export class JevClientError extends Error {
  override name = "JevClientError";
  readonly kind: JevClientErrorKind;
  readonly status: number | null;

  constructor(kind: JevClientErrorKind, status: number | null = null) {
    super(`jev-${kind}`);
    this.kind = kind;
    this.status = status;
  }
}

export type JevInput = {
  state: object;
  questions: object;
};

export type JevTiming = {
  timeoutMs?: number;
  retryDelayMs?: number;
};

const isRetryable = (error: unknown): boolean =>
  error instanceof JevClientError &&
  error.kind === "http" &&
  error.status !== null &&
  (error.status === 429 || error.status >= 500);

const abortError = (): DOMException => new DOMException("The operation was aborted", "AbortError");

// Resolves after the delay, or early when the signal aborts. The timer and the
// listener are always released.
const wait = async (milliseconds: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    await new Promise<void>((resolve) => {
      onAbort = resolve;
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(resolve, milliseconds);
    });
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
};

const attempt = async (
  apiKey: string,
  body: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<JevResponse> => {
  let response: Response;

  try {
    response = await fetchImpl(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal,
    });
  } catch {
    throw new JevClientError("network");
  }

  if (!response.ok) {
    throw new JevClientError("http", response.status);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new JevClientError("invalid-response", response.status);
  }

  if (!isJevResponse(payload)) {
    throw new JevClientError("invalid-response", response.status);
  }

  return payload;
};

export const runJev = async (
  apiKey: string,
  input: JevInput,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  timing: JevTiming = {},
): Promise<JevResponse> => {
  const timeoutMs = timing.timeoutMs ?? JEV_TIMEOUT_MS;
  const retryDelayMs = timing.retryDelayMs ?? JEV_RETRY_DELAY_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, timeoutMs);
  const combined = AbortSignal.any([signal, deadline.signal]);
  const body = JSON.stringify({ model: JEV_MODEL, state: input.state, questions: input.questions });

  // A caller abort must look like one (the route answers 408); the client's
  // own deadline must not.
  const interruption = (): Error | null => {
    if (signal.aborted) {
      return abortError();
    }

    return deadline.signal.aborted ? new JevClientError("timeout") : null;
  };

  try {
    try {
      return await attempt(apiKey, body, combined, fetchImpl);
    } catch (error) {
      const interrupted = interruption();

      if (interrupted) {
        throw interrupted;
      }

      if (!isRetryable(error)) {
        throw error;
      }
    }

    await wait(retryDelayMs, combined);

    const interruptedWhileWaiting = interruption();

    if (interruptedWhileWaiting) {
      throw interruptedWhileWaiting;
    }

    try {
      return await attempt(apiKey, body, combined, fetchImpl);
    } catch (error) {
      throw interruption() ?? error;
    }
  } finally {
    clearTimeout(timer);
  }
};
