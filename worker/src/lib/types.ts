import type { Layer } from "effect";
import type { GitHubClient } from "../github/client";

export type WorkerBindings = {
  APP_NAME: string;
  GITHUB_PAT: string;
  SENTRY_DSN?: string;
};

export type AppVariables = {
  githubLayer: Layer.Layer<GitHubClient>;
};

export type AppEnv = {
  Bindings: WorkerBindings;
  Variables: AppVariables;
};
