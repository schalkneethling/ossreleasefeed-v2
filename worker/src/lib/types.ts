import type { Layer } from "effect";
import type { GitHubClient } from "../github/client";

export type WorkerBindings = {
  APP_NAME: string;
  GITHUB_PAT: string;
  SENTRY_DSN?: string;
  // Required for an assistant turn that needs inference; a Worker secret in
  // production. Local development may leave it empty, which makes Ask mode
  // answer 503 while everything else keeps working.
  TYPESAFE_API_KEY?: string;
  FLAGS?: Flagship;
  ASSISTANT_CLIENT_RATE_LIMITER?: RateLimit;
  ASSISTANT_NETWORK_RATE_LIMITER?: RateLimit;
};

export type AppVariables = {
  githubLayer: Layer.Layer<GitHubClient>;
  // What handled an assistant turn (the Jev model id, or the canned-suggestion
  // path), for diagnostics.
  assistantModel?: string;
};

export type AppEnv = {
  Bindings: WorkerBindings;
  Variables: AppVariables;
};
