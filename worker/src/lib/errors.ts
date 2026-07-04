import { Data } from "effect";

export class GitHubRateLimitError extends Data.TaggedError("GitHubRateLimitError")<{
  readonly retryAfter: number;
}> {}

export class GitHubNotFoundError extends Data.TaggedError("GitHubNotFoundError")<{
  readonly resource: string;
}> {}

export class GitHubNetworkError extends Data.TaggedError("GitHubNetworkError")<{
  readonly cause: unknown;
}> {}

export class FeedParseError extends Data.TaggedError("FeedParseError")<{
  readonly url: string;
  readonly cause: unknown;
}> {}
