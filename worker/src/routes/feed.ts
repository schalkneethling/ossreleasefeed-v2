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
const MAX_FEED_ENTRIES = 250;

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

const buildSerializedFeed = (
  config: AppEnv["Bindings"] extends never ? never : Parameters<typeof buildFeed>[0],
  entries: Parameters<typeof buildFeed>[1],
  url: string,
  appName: string,
  format: "atom" | "json",
) => {
  const feed = buildFeed(config, entries, url, appName);

  return format === "json" ? feed.json1() : feed.atom1();
};

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
  let previousEntries = [] as ReturnType<typeof parseCachedFeed>;

  if (previousFeedText) {
    try {
      previousEntries = parseCachedFeed(previousFeedText, request.url);
    } catch {
      previousEntries = [];
    }
  }

  try {
    const freshEntries = await Effect.runPromise(
      generateFeedEntries(config).pipe(Effect.provide(ctx.var.githubLayer)),
    );
    const newEntries = diffFeed(previousFeedText, freshEntries);

    if (previousFeedText && newEntries.length === 0) {
      const body = buildSerializedFeed(
        config,
        previousEntries,
        request.url,
        ctx.env.APP_NAME,
        config.format,
      );
      const unchanged = renderFeed(body, config.ttl, config.format);

      await cache?.put(request, unchanged.clone());

      return unchanged;
    }

    const mergedEntries = mergeEntries(freshEntries, previousEntries).slice(0, MAX_FEED_ENTRIES);
    const body = buildSerializedFeed(
      config,
      mergedEntries,
      request.url,
      ctx.env.APP_NAME,
      config.format,
    );
    const snapshotBody = buildSerializedFeed(
      { ...config, format: "atom" },
      mergedEntries,
      request.url,
      ctx.env.APP_NAME,
      "atom",
    );
    const response = renderFeed(body, config.ttl, config.format);
    const snapshotResponse = renderFeed(snapshotBody, 60 * 60 * 24 * 7, "atom");

    await cache?.put(request, response.clone());
    await cache?.put(snapshotRequest, snapshotResponse.clone());

    return response;
  } catch (error) {
    if (error instanceof GitHubRateLimitError && previousFeedText) {
      const body = buildSerializedFeed(
        config,
        previousEntries,
        request.url,
        ctx.env.APP_NAME,
        config.format,
      );

      return renderFeed(body, config.ttl, config.format, error.retryAfter);
    }

    return ctx.json(
      {
        error: "GitHub temporarily unavailable",
      },
      503,
    );
  }
});
