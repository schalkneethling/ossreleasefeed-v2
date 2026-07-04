import { Octokit } from "@octokit/rest";
import { Context, Effect, Either, Layer, Schedule } from "effect";
import {
  FeedParseError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
} from "../lib/errors";
import {
  IssueSchema,
  RepoSchema,
  TopicSearchResponseSchema,
  type FeedEntry,
  type Issue,
  type Repo,
  type Topic,
} from "../lib/schemas";
import { Schema } from "effect";
import { parseGitHubReleaseAtom } from "../feed/xml";

const retrySchedule = Schedule.recurs(2).pipe(
  Schedule.whileInput((error: unknown) => error instanceof GitHubRateLimitError),
);

const parseWithSchema =
  <A, I>(schema: Schema.Schema<A, I>) =>
  (input: unknown): Effect.Effect<A, GitHubNetworkError> => {
    const decoded = Schema.decodeUnknownEither(schema)(input);

    if (Either.isLeft(decoded)) {
      return Effect.fail(new GitHubNetworkError({ cause: decoded.left }));
    }

    return Effect.succeed(decoded.right);
  };

const getRetryAfter = (error: unknown): number => {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "headers" in error.response &&
    error.response.headers &&
    typeof error.response.headers === "object" &&
    "retry-after" in error.response.headers
  ) {
    const retryAfter = Number(error.response.headers["retry-after"]);

    if (!Number.isNaN(retryAfter)) {
      return retryAfter;
    }
  }

  return 60;
};

const mapGitHubError = (error: unknown, resource: string) => {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);

    if (status === 404) {
      return new GitHubNotFoundError({ resource });
    }

    if (status === 403 || status === 429) {
      return new GitHubRateLimitError({ retryAfter: getRetryAfter(error) });
    }
  }

  return new GitHubNetworkError({ cause: error });
};

const mapIssueEntry = (repo: Repo, issue: Issue): FeedEntry => ({
  id: issue.html_url,
  link: issue.html_url,
  title: issue.title,
  summary: issue.body ?? "",
  date: new Date(issue.updated_at),
  authorLogin: issue.user.login,
  repo: repo.full_name,
  entryType: issue.pull_request ? "pull_request" : "issue",
});

export interface GitHubClientService {
  readonly getFeaturedTopics: () => Effect.Effect<
    Topic[],
    GitHubRateLimitError | GitHubNetworkError | GitHubNotFoundError
  >;
  readonly validateTopic: (
    slug: string,
  ) => Effect.Effect<boolean, GitHubRateLimitError | GitHubNetworkError | GitHubNotFoundError>;
  readonly validateUsername: (
    username: string,
  ) => Effect.Effect<{ exists: boolean; hasStars: boolean }, GitHubNetworkError>;
  readonly getStarredRepos: (
    username: string,
  ) => Effect.Effect<Repo[], GitHubRateLimitError | GitHubNotFoundError | GitHubNetworkError>;
  readonly searchRepositoriesByTopics: (
    topics: readonly string[],
    operator: "and" | "or",
  ) => Effect.Effect<Repo[], GitHubRateLimitError | GitHubNetworkError | GitHubNotFoundError>;
  readonly getRepoReleases: (
    owner: string,
    repo: string,
  ) => Effect.Effect<
    FeedEntry[],
    GitHubRateLimitError | GitHubNotFoundError | GitHubNetworkError | FeedParseError
  >;
  readonly getRepoIssues: (
    owner: string,
    repo: string,
  ) => Effect.Effect<FeedEntry[], GitHubRateLimitError | GitHubNotFoundError | GitHubNetworkError>;
}

export class GitHubClient extends Context.Tag("GitHubClient")<
  GitHubClient,
  GitHubClientService
>() {}

export const makeGitHubClient = (octokit: Octokit): GitHubClientService => ({
  getFeaturedTopics: () =>
    Effect.tryPromise({
      try: () =>
        octokit.rest.search.topics({
          q: "is:featured",
          per_page: 25,
        }),
      catch: (error) => mapGitHubError(error, "featured-topics"),
    }).pipe(
      Effect.flatMap((response) => parseWithSchema(TopicSearchResponseSchema)(response.data)),
      Effect.map((payload) => [...payload.items]),
    ),
  validateTopic: (slug) =>
    Effect.tryPromise({
      try: () =>
        octokit.rest.search.topics({
          q: slug,
          per_page: 10,
        }),
      catch: (error) => mapGitHubError(error, `topic:${slug}`),
    }).pipe(
      Effect.flatMap((response) => parseWithSchema(TopicSearchResponseSchema)(response.data)),
      Effect.map((payload) => payload.items.some((item) => item.name === slug)),
    ),
  validateUsername: (username) =>
    Effect.tryPromise({
      try: async () => {
        await octokit.rest.users.getByUsername({ username });
        const starred = await octokit.rest.activity.listReposStarredByUser({
          username,
          per_page: 1,
        });

        return {
          exists: true,
          hasStars: starred.data.length > 0,
        };
      },
      catch: (error) => mapGitHubError(error, `user:${username}`),
    }).pipe(
      Effect.catchTag("GitHubNotFoundError", () =>
        Effect.succeed({
          exists: false,
          hasStars: false,
        }),
      ),
      Effect.mapError((error) =>
        error instanceof GitHubNetworkError ? error : new GitHubNetworkError({ cause: error }),
      ),
    ),
  getStarredRepos: (username) =>
    Effect.tryPromise({
      try: async () => {
        const response = await octokit.paginate(octokit.rest.activity.listReposStarredByUser, {
          username,
          per_page: 100,
        });

        return response.slice(0, 100);
      },
      catch: (error) => mapGitHubError(error, `starred:${username}`),
    }).pipe(
      Effect.flatMap((repos) =>
        Effect.all(
          repos.map((repo) => parseWithSchema(RepoSchema)(repo)),
          { concurrency: 20 },
        ),
      ),
      Effect.retry(retrySchedule),
    ),
  searchRepositoriesByTopics: (topics, operator) =>
    Effect.tryPromise({
      try: async () => {
        if (operator === "and") {
          const query = topics.map((topic) => `topic:${topic}`).join(" ");
          const response = await octokit.rest.search.repos({
            q: query,
            per_page: 25,
            sort: "stars",
          });

          return response.data.items;
        }

        const responses = await Promise.all(
          topics.map((topic) =>
            octokit.rest.search.repos({
              q: `topic:${topic}`,
              per_page: 25,
              sort: "stars",
            }),
          ),
        );

        return responses.flatMap((response) => response.data.items);
      },
      catch: (error) => mapGitHubError(error, `topics:${topics.join(",")}`),
    }).pipe(
      Effect.flatMap((repos) =>
        Effect.all(
          repos.map((repo) => parseWithSchema(RepoSchema)(repo)),
          { concurrency: 20 },
        ),
      ),
      Effect.map((repos) => {
        const deduped = new Map<string, Repo>();

        repos.forEach((repo) => {
          deduped.set(repo.full_name, repo);
        });

        return [...deduped.values()].slice(0, 25);
      }),
    ),
  getRepoReleases: (owner, repo) =>
    Effect.tryPromise({
      try: async () => {
        const url = `https://github.com/${owner}/${repo}/releases.atom`;
        const response = await fetch(url, {
          headers: {
            "user-agent": "ossreleasefeed",
          },
        });

        if (response.status === 404) {
          throw new GitHubNotFoundError({ resource: `${owner}/${repo}` });
        }

        if (response.status === 403 || response.status === 429) {
          throw new GitHubRateLimitError({
            retryAfter: Number(response.headers.get("retry-after") ?? "60"),
          });
        }

        if (!response.ok) {
          throw new GitHubNetworkError({
            cause: new Error(`GitHub atom fetch failed with ${response.status}`),
          });
        }

        return {
          url,
          xml: await response.text(),
        };
      },
      catch: (error) => {
        if (
          error instanceof GitHubNotFoundError ||
          error instanceof GitHubRateLimitError ||
          error instanceof GitHubNetworkError
        ) {
          return error;
        }

        return new GitHubNetworkError({ cause: error });
      },
    }).pipe(
      Effect.flatMap(({ url, xml }) =>
        Effect.tryPromise({
          try: () => parseGitHubReleaseAtom(xml, `${owner}/${repo}`, url),
          catch: (error) =>
            error instanceof FeedParseError
              ? error
              : new FeedParseError({
                  url: `https://github.com/${owner}/${repo}/releases.atom`,
                  cause: error,
                }),
        }),
      ),
      Effect.retry(retrySchedule),
    ),
  getRepoIssues: (owner, repo) =>
    Effect.tryPromise({
      try: () =>
        octokit.rest.issues.listForRepo({
          owner,
          repo,
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: 10,
        }),
      catch: (error) => mapGitHubError(error, `${owner}/${repo}:issues`),
    }).pipe(
      Effect.flatMap((response) =>
        Effect.all(
          response.data.map((issue) => parseWithSchema(IssueSchema)(issue)),
          {
            concurrency: 20,
          },
        ),
      ),
      Effect.map((issues) => {
        const repoData: Repo = {
          full_name: `${owner}/${repo}`,
          name: repo,
          description: null,
          stargazers_count: 0,
          owner: { login: owner },
        };

        return issues.map((issue) => mapIssueEntry(repoData, issue));
      }),
      Effect.retry(retrySchedule),
    ),
});

export const makeGitHubLayer = (octokit: Octokit) =>
  Layer.succeed(GitHubClient, makeGitHubClient(octokit));
