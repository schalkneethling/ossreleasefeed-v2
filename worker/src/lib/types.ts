import type { Layer } from "effect";
import type { GitHubClient } from "../github/client";

export type WorkerBindings = {
  APP_NAME: string;
  GITHUB_PAT: string;
  SENTRY_DSN?: string;
  // Read only when the Jev interpreter flag is on; a Worker secret in production.
  TYPESAFE_API_KEY?: string;
  AI?: {
    run(
      model: string,
      input: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): Promise<unknown>;
  };
  FLAGS?: Flagship;
  ASSISTANT_CLIENT_RATE_LIMITER?: RateLimit;
  ASSISTANT_NETWORK_RATE_LIMITER?: RateLimit;
};

export type AppVariables = {
  githubLayer: Layer.Layer<GitHubClient>;
  // Model id of the interpreter chosen for an assistant turn, for diagnostics.
  assistantModel?: string;
};

export type AppEnv = {
  Bindings: WorkerBindings;
  Variables: AppVariables;
};
