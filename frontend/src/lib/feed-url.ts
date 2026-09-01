import { isRepoSelectionComplete, type FeedDraft } from "./assistant";
import { feedUrl as createApiFeedUrl } from "./api";
import { encodeFeedConfig } from "./config";

export const createFeedUrlForDraft = (draft: FeedDraft): string | null => {
  if (draft.source === "topics" && draft.topics.length > 0) {
    return createApiFeedUrl(
      encodeFeedConfig({
        source: "topics",
        topics: draft.topics,
        topicOperator: "or",
        activityType: draft.activityType,
        ttl: draft.ttl,
        format: "atom",
      }),
    );
  }

  if (
    draft.source === "starred" &&
    draft.username !== null &&
    isRepoSelectionComplete(draft.repoSelection)
  ) {
    return createApiFeedUrl(
      encodeFeedConfig({
        source: "starred",
        username: draft.username,
        repos: draft.repoSelection?.kind === "subset" ? draft.repoSelection.repos : null,
        activityType: draft.activityType,
        ttl: draft.ttl,
        format: "atom",
      }),
    );
  }

  return null;
};
