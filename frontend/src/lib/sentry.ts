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
