import * as Sentry from "@sentry/react";

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  const tracesSampleRate = import.meta.env.PROD ? 0.1 : 1.0;

  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate,
  });
}

export function captureWebMcpRegistrationError(toolName: string, error: unknown): void {
  const errorName = error instanceof Error ? error.name : "UnknownError";

  Sentry.captureException(new Error(`WebMCP registration failed (${errorName})`), {
    tags: {
      feature: "webmcp",
      tool: toolName,
    },
  });
}
