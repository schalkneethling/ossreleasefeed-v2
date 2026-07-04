import type { FeedEntry } from "../lib/schemas";
import { parseCachedFeed } from "./xml";

export const diffFeed = (cachedFeed: string | null, freshEntries: FeedEntry[]): FeedEntry[] => {
  if (!cachedFeed) {
    return freshEntries;
  }

  let existingEntries: FeedEntry[] = [];

  try {
    existingEntries = parseCachedFeed(cachedFeed, "cached-feed");
  } catch {
    return freshEntries;
  }

  const existingLinks = new Set(existingEntries.map((entry) => entry.link));

  return freshEntries.filter((entry) => !existingLinks.has(entry.link));
};
