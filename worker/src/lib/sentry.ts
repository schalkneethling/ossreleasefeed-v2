import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions } from "@sentry/cloudflare";
import type { WorkerBindings } from "./types";

export function sentryOptions(env: WorkerBindings): CloudflareOptions | undefined {
  if (!env.SENTRY_DSN) {
    return undefined;
  }

  return {
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  };
}

const isTaggedError = (error: unknown): error is { _tag: string } =>
  typeof error === "object" && error !== null && "_tag" in error;

// GitHub errors carry usernames/topic names in their fields (resource, url).
// The tech spec forbids sending user-provided data to Sentry, so only the
// error's discriminant tag is forwarded, never the original error object.
export function sanitizeFeedError(error: unknown): Error {
  const tag = isTaggedError(error) ? error._tag : "UnknownError";

  return new Error(`Feed generation failed: ${tag}`);
}

export function captureFeedError(error: unknown): void {
  Sentry.captureException(sanitizeFeedError(error));
}
