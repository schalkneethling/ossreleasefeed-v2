import type { FeedEntry } from "../lib/schemas";
import { parseCachedFeed } from "./xml";

export const diffFeed = (cachedFeed: string | null, freshEntries: FeedEntry[]): FeedEntry[] => {
  if (!cachedFeed) {
    return freshEntries;
  }

  const existingLinks = new Set(
    parseCachedFeed(cachedFeed, "cached-feed").map((entry) => entry.link),
  );

  return freshEntries.filter((entry) => !existingLinks.has(entry.link));
};
