import { Either, Effect } from "effect";
import { Hono } from "hono";
import { buildFeed, mergeEntries } from "../feed/build";
import { diffFeed } from "../feed/diff";
import { generateFeedEntries } from "../feed/generate";
import { parseCachedFeed } from "../feed/xml";
import { createSnapshotRequest, getCache } from "../lib/cache";
import { decodeFeedConfig } from "../lib/config";
import { GitHubRateLimitError } from "../lib/errors";
import { invalidFeedConfig } from "../lib/http";
import type { AppEnv } from "../lib/types";

const cacheHeader = (ttl: number) => `public, max-age=${Math.max(ttl, 3600)}`;

const renderFeed = (body: string, ttl: number, format: "atom" | "json", retryAfter?: number) =>
  new Response(body, {
    headers: {
      "Cache-Control": cacheHeader(ttl),
      "Content-Type":
        format === "json"
          ? "application/feed+json; charset=utf-8"
          : "application/atom+xml; charset=utf-8",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });

export const feedRoutes = new Hono<AppEnv>();

feedRoutes.get("/:config", async (ctx) => {
  const decoded = decodeFeedConfig(ctx.req.param("config"));

  if (Either.isLeft(decoded)) {
    return invalidFeedConfig(ctx, decoded.left);
  }

  const config = decoded.right;
  const cache = getCache();
  const request = ctx.req.raw;
  const cached = await cache?.match(request);

  if (cached) {
    return cached;
  }

  const snapshotRequest = createSnapshotRequest(request);
  const previousSnapshot = await cache?.match(snapshotRequest);
  const previousFeedText = previousSnapshot ? await previousSnapshot.text() : null;

  try {
    const freshEntries = await Effect.runPromise(
      generateFeedEntries(config).pipe(Effect.provide(ctx.var.githubLayer)),
    );
    const newEntries = diffFeed(previousFeedText, freshEntries);

    if (previousFeedText && newEntries.length === 0) {
      const unchanged = renderFeed(previousFeedText, config.ttl, config.format);

      await cache?.put(request, unchanged.clone());

      return unchanged;
    }

    const previousEntries = previousFeedText ? parseCachedFeed(previousFeedText, request.url) : [];
    const mergedEntries = mergeEntries(freshEntries, previousEntries);
    const feed = buildFeed(config, mergedEntries, request.url, ctx.env.APP_NAME);
    const body = config.format === "json" ? feed.json1() : feed.atom1();
    const response = renderFeed(body, config.ttl, config.format);
    const snapshotResponse = renderFeed(body, 60 * 60 * 24 * 7, config.format);

    await cache?.put(request, response.clone());
    await cache?.put(snapshotRequest, snapshotResponse.clone());

    return response;
  } catch (error) {
    if (error instanceof GitHubRateLimitError && previousFeedText) {
      return renderFeed(previousFeedText, config.ttl, config.format, error.retryAfter);
    }

    return ctx.json(
      {
        error: "GitHub temporarily unavailable",
      },
      503,
    );
  }
});
