import { sValidator } from "@hono/standard-validator";
import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { getCache } from "../lib/cache";
import { unavailableFromGitHub, validationHook } from "../lib/http";
import { GithubUsernameSchema } from "../lib/schemas";
import type { AppEnv } from "../lib/types";
import { GitHubClient } from "../github/client";

export const usersRoutes = new Hono<AppEnv>();

usersRoutes.get(
  "/validate/:username",
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
    let result;

    try {
      result = await Effect.runPromise(
        Effect.flatMap(GitHubClient, (client) => client.validateUsername(username)).pipe(
          Effect.provide(ctx.var.githubLayer),
        ),
      );
    } catch (error) {
      return unavailableFromGitHub(ctx, error);
    }
    const response = ctx.json(
      {
        exists: result.exists,
        username: result.exists ? username : null,
        hasStars: result.hasStars,
      },
      200,
      {
        "Cache-Control": "public, max-age=300",
      },
    );

    await cache?.put(ctx.req.raw, response.clone());

    return response;
  },
);
