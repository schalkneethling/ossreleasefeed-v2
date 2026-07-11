import { Effect } from "effect";
import type { FeedConfig, FeedEntry } from "../lib/schemas";
import type { Repo } from "../lib/schemas";
import { mergeEntries } from "./build";
import type { GitHubClientService } from "../github/client";
import { GitHubClient } from "../github/client";

const MAX_REPOS = 25;
// Cloudflare Workers free plan caps at 50 subrequests per invocation. Each
// repo costs 2 subrequests when activityType is "all" (releases + issues).
// Topics search adds its own subrequests on top of that: 1 for "and" (a
// single combined query) or one per topic for "or" (parallel per-topic
// queries, up to 5) — so the repo cap has to shrink to account for them.
// 48 keeps 2 requests of headroom under the 50-request ceiling.
const SUBREQUEST_BUDGET_ALL_ACTIVITY = 48;

const reposLimitForAllActivity = (searchSubrequests = 0) =>
  Math.floor((SUBREQUEST_BUDGET_ALL_ACTIVITY - searchSubrequests) / 2);

const splitRepo = (fullName: string) => {
  const [owner, repo] = fullName.split("/");

  return { owner, repo };
};

// A 404, network error, or parse error on a single repo returns an empty list
// rather than aborting the whole feed. Rate-limit errors propagate so feed.ts
// can fall back to a stale cached feed.
const fetchReleases = (repos: Repo[]) =>
  Effect.flatMap(GitHubClient, (client) =>
    Effect.all(
      repos.map((repo) =>
        client.getRepoReleases(repo.owner.login, repo.name).pipe(
          Effect.catchTag("GitHubNotFoundError", () => Effect.succeed([] as FeedEntry[])),
          Effect.catchTag("GitHubNetworkError", () => Effect.succeed([] as FeedEntry[])),
          Effect.catchTag("FeedParseError", () => Effect.succeed([] as FeedEntry[])),
        ),
      ),
      { concurrency: 20 },
    ).pipe(Effect.map((entries) => entries.flat())),
  );

const fetchIssues = (repos: Repo[]) =>
  Effect.flatMap(GitHubClient, (client) =>
    Effect.all(
      repos.map((repo) =>
        client.getRepoIssues(repo.owner.login, repo.name).pipe(
          Effect.catchTag("GitHubNotFoundError", () => Effect.succeed([] as FeedEntry[])),
          Effect.catchTag("GitHubNetworkError", () => Effect.succeed([] as FeedEntry[])),
        ),
      ),
      { concurrency: 20 },
    ).pipe(Effect.map((entries) => entries.flat())),
  );

const reposFromSelection = (selectedRepos: readonly string[]): Repo[] =>
  selectedRepos.map((full_name) => {
    const { owner, repo } = splitRepo(full_name);

    return {
      full_name,
      name: repo,
      description: null,
      stargazers_count: 0,
      owner: { login: owner },
    };
  });

export const generateFeedEntries = (
  config: FeedConfig,
): Effect.Effect<FeedEntry[], unknown, GitHubClient> =>
  Effect.flatMap(GitHubClient, (client: GitHubClientService) => {
    if (config.source === "topics") {
      return Effect.flatMap(
        client.searchRepositoriesByTopics(config.topics, config.topicOperator),
        (repos) => {
          const searchSubrequests = config.topicOperator === "or" ? config.topics.length : 1;
          const limit =
            config.activityType === "all" ? reposLimitForAllActivity(searchSubrequests) : MAX_REPOS;
          const capped = repos.slice(0, limit);

          return Effect.all(
            [
              fetchReleases(capped),
              config.activityType === "all"
                ? fetchIssues(capped)
                : Effect.succeed([] as FeedEntry[]),
            ],
            { concurrency: 2 },
          ).pipe(Effect.map(([releases, issues]) => mergeEntries(releases, issues)));
        },
      );
    }

    if (config.repos && config.repos.length > 0) {
      const limit = config.activityType === "all" ? reposLimitForAllActivity() : MAX_REPOS;
      const repos = reposFromSelection(config.repos).slice(0, limit);

      return Effect.all(
        [
          fetchReleases(repos),
          config.activityType === "all" ? fetchIssues(repos) : Effect.succeed([] as FeedEntry[]),
        ],
        { concurrency: 2 },
      ).pipe(Effect.map(([releases, issues]) => mergeEntries(releases, issues)));
    }

    return Effect.flatMap(client.getStarredRepos(config.username), (repos) => {
      const limit = config.activityType === "all" ? reposLimitForAllActivity() : MAX_REPOS;
      const capped = repos.slice(0, limit);

      return Effect.all(
        [
          fetchReleases(capped),
          config.activityType === "all" ? fetchIssues(capped) : Effect.succeed([] as FeedEntry[]),
        ],
        { concurrency: 2 },
      ).pipe(Effect.map(([releases, issues]) => mergeEntries(releases, issues)));
    });
  });
