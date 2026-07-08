import { Effect } from "effect";
import type { FeedConfig, FeedEntry } from "../lib/schemas";
import type { Repo } from "../lib/schemas";
import { mergeEntries } from "./build";
import type { GitHubClientService } from "../github/client";
import { GitHubClient } from "../github/client";

const MAX_REPOS = 25;
// Cloudflare Workers free plan caps at 50 subrequests per invocation.
// Each repo costs 2 subrequests when activityType is "all" (releases + issues),
// so cap lower to leave headroom for search/paginate calls.
const MAX_REPOS_ALL_ACTIVITY = 24;

const splitRepo = (fullName: string) => {
  const [owner, repo] = fullName.split("/");

  return { owner, repo };
};

const fetchReleases = (repos: Repo[]) =>
  Effect.flatMap(GitHubClient, (client) =>
    Effect.all(
      repos.map((repo) => client.getRepoReleases(repo.owner.login, repo.name)),
      { concurrency: 20 },
    ).pipe(Effect.map((entries) => entries.flat())),
  );

const fetchIssues = (repos: Repo[]) =>
  Effect.flatMap(GitHubClient, (client) =>
    Effect.all(
      repos.map((repo) => client.getRepoIssues(repo.owner.login, repo.name)),
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
          const limit =
            config.activityType === "all" ? MAX_REPOS_ALL_ACTIVITY : MAX_REPOS;
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
      const limit =
        config.activityType === "all" ? MAX_REPOS_ALL_ACTIVITY : MAX_REPOS;
      const repos = reposFromSelection(config.repos).slice(0, limit);

      return Effect.all(
        [
          fetchReleases(repos),
          config.activityType === "all" ? fetchIssues(repos) : Effect.succeed([] as FeedEntry[]),
        ],
        { concurrency: 2 },
      ).pipe(Effect.map(([releases, issues]) => mergeEntries(releases, issues)));
    }

    return Effect.flatMap(client.getStarredRepos(config.username), (repos) =>
      Effect.all(
        [
          fetchReleases(repos.slice(0, config.activityType === "all" ? MAX_REPOS_ALL_ACTIVITY : MAX_REPOS)),
          config.activityType === "all"
            ? fetchIssues(repos.slice(0, MAX_REPOS_ALL_ACTIVITY))
            : Effect.succeed([] as FeedEntry[]),
        ],
        { concurrency: 2 },
      ).pipe(Effect.map(([releases, issues]) => mergeEntries(releases, issues))),
    );
  });
