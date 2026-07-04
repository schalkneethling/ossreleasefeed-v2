import { Effect } from "effect";
import type { FeedConfig, FeedEntry } from "../lib/schemas";
import type { Repo } from "../lib/schemas";
import { mergeEntries } from "./build";
import type { GitHubClientService } from "../github/client";
import { GitHubClient } from "../github/client";

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
        (repos) =>
          Effect.all(
            [
              fetchReleases(repos),
              config.activityType === "all"
                ? fetchIssues(repos)
                : Effect.succeed([] as FeedEntry[]),
            ],
            { concurrency: 2 },
          ).pipe(Effect.map(([releases, issues]) => mergeEntries(releases, issues))),
      );
    }

    if (config.repos && config.repos.length > 0) {
      const repos = reposFromSelection(config.repos);

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
          fetchReleases(repos.slice(0, 25)),
          config.activityType === "all"
            ? fetchIssues(repos.slice(0, 25))
            : Effect.succeed([] as FeedEntry[]),
        ],
        { concurrency: 2 },
      ).pipe(Effect.map(([releases, issues]) => mergeEntries(releases, issues))),
    );
  });
