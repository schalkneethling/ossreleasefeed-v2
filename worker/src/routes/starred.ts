import { sValidator } from "@hono/standard-validator";
import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { GitHubNotFoundError, GitHubRateLimitError } from "../lib/errors";
import { getCache } from "../lib/cache";
import { unavailableFromGitHub, validationHook } from "../lib/http";
import { runEffect } from "../lib/run";
import { GithubUsernameSchema } from "../lib/schemas";
import type { AppEnv } from "../lib/types";
import { GitHubClient } from "../github/client";

export const starredRoutes = new Hono<AppEnv>();

starredRoutes.get(
  "/:username",
  sValidator(
    "param",
    Schema.standardSchemaV1(Schema.Struct({ username: GithubUsernameSchema })),
    validationHook,
  ),
  async (ctx) => {
    const cache = getCache();
    const cached = await cache?.match(ctx.req.raw);

    if (cached) {
      return cached;
    }

    const { username } = ctx.req.valid("param");

    try {
      const repos = await runEffect(
        Effect.flatMap(GitHubClient, (client) => client.getStarredRepos(username)).pipe(
          Effect.provide(ctx.var.githubLayer),
        ),
      );
      const response = ctx.json(repos, 200, {
        "Cache-Control": "public, max-age=3600",
      });

      await cache?.put(ctx.req.raw, response.clone());

      return response;
    } catch (error) {
      if (error instanceof GitHubNotFoundError) {
        return ctx.json(
          {
            error: "Not found",
          },
          404,
        );
      }

      if (error instanceof GitHubRateLimitError) {
        return unavailableFromGitHub(ctx, error);
      }

      throw error;
    }
  },
);
