export type WorkerEnv = {
  SENTRY_DSN?: string;
};

export function initSentry(_env: WorkerEnv): void {
  // Phase 1 scaffold: runtime wiring happens in Phase 4.
}
