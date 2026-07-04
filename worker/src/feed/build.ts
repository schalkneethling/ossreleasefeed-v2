import { Feed } from "feed";
import type { FeedConfig, FeedEntry } from "../lib/schemas";

const typeLabel: Record<FeedEntry["entryType"], string> = {
  issue: "Issue",
  pull_request: "PR",
  release: "Release",
};

export const mergeEntries = (left: FeedEntry[], right: FeedEntry[]): FeedEntry[] => {
  const deduped = new Map<string, FeedEntry>();

  [...left, ...right].forEach((entry) => {
    deduped.set(entry.link, entry);
  });

  return [...deduped.values()].sort(
    (first, second) => second.date.getTime() - first.date.getTime(),
  );
};

export const buildFeed = (
  config: FeedConfig,
  entries: FeedEntry[],
  feedUrl: string,
  appName: string,
): Feed => {
  const updated = entries[0]?.date ?? new Date();
  const title =
    config.source === "topics"
      ? `${appName}: ${config.topics.join(", ")}`
      : `${appName}: ${config.username} starred repositories`;

  const feed = new Feed({
    id: feedUrl,
    title,
    link: feedUrl,
    feedLinks: {
      atom: config.format === "atom" ? feedUrl : undefined,
      json: config.format === "json" ? feedUrl : undefined,
    },
    updated,
    generator: appName,
  });

  entries.forEach((entry) => {
    feed.addItem({
      id: entry.id,
      link: entry.link,
      title: `[${entry.repo}] ${typeLabel[entry.entryType]}: ${entry.title}`,
      description: entry.summary,
      content: entry.summary,
      date: entry.date,
      author: [{ name: entry.authorLogin }],
    });
  });

  return feed;
};
