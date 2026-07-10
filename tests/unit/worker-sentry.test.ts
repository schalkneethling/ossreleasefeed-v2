import { describe, expect, it } from "vitest";
import { sanitizeFeedError, sentryOptions } from "../../worker/src/lib/sentry";

describe("sentryOptions", () => {
  it("returns undefined when SENTRY_DSN is unset, so the SDK never initializes", () => {
    expect(sentryOptions({ APP_NAME: "ossreleasefeed", GITHUB_PAT: "token" })).toBeUndefined();
  });

  it("returns the DSN config when SENTRY_DSN is set", () => {
    const options = sentryOptions({
      APP_NAME: "ossreleasefeed",
      GITHUB_PAT: "token",
      SENTRY_DSN: "https://example@o0.ingest.sentry.io/1",
    });

    expect(options).toEqual({
      dsn: "https://example@o0.ingest.sentry.io/1",
      tracesSampleRate: 0.1,
    });
  });
});

describe("sanitizeFeedError", () => {
  it("keeps only the error's tag, never user-provided fields", () => {
    const taggedError = { _tag: "GitHubNotFoundError", resource: "octocat/secret-repo" };
    const sanitized = sanitizeFeedError(taggedError);

    expect(sanitized).toBeInstanceOf(Error);
    expect(sanitized.message).toBe("Feed generation failed: GitHubNotFoundError");
    expect(sanitized.message).not.toContain("secret-repo");
  });

  it("falls back to UnknownError for errors without a discriminant tag", () => {
    expect(sanitizeFeedError(new Error("boom")).message).toBe(
      "Feed generation failed: UnknownError",
    );
  });
});
