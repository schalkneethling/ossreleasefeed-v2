import { sValidator } from "@hono/standard-validator";
import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { getCache } from "../lib/cache";
import { unavailableFromGitHub, validationHook } from "../lib/http";
import { runEffect } from "../lib/run";
import type { AppEnv } from "../lib/types";
import { TopicSlugSchema } from "../lib/schemas";
import { GitHubClient } from "../github/client";

export const topicsRoutes = new Hono<AppEnv>();

topicsRoutes.get("/featured", async (ctx) => {
  const cache = getCache();
  const cached = await cache?.match(ctx.req.raw);

  if (cached) {
    return cached;
  }

  let topics;

  try {
    topics = await runEffect(
      Effect.flatMap(GitHubClient, (client) => client.getFeaturedTopics()).pipe(
        Effect.provide(ctx.var.githubLayer),
      ),
    );
  } catch (error) {
    return unavailableFromGitHub(ctx, error);
  }

  const response = ctx.json(topics, 200, {
    "Cache-Control": "public, max-age=86400",
  });

  await cache?.put(ctx.req.raw, response.clone());

  return response;
});

topicsRoutes.get(
  "/validate",
  sValidator(
    "query",
    Schema.standardSchemaV1(Schema.Struct({ q: TopicSlugSchema })),
    validationHook,
  ),
  async (ctx) => {
    const cache = getCache();
    const cached = await cache?.match(ctx.req.raw);

    if (cached) {
      return cached;
    }

    const { q } = ctx.req.valid("query");
    let exists;

    try {
      exists = await runEffect(
        Effect.flatMap(GitHubClient, (client) => client.validateTopic(q)).pipe(
          Effect.provide(ctx.var.githubLayer),
        ),
      );
    } catch (error) {
      return unavailableFromGitHub(ctx, error);
    }
    const response = ctx.json(
      {
        exists,
        name: exists ? q : null,
      },
      200,
      {
        "Cache-Control": "public, max-age=3600",
      },
    );

    await cache?.put(ctx.req.raw, response.clone());

    return response;
  },
);
