import type { Context } from "hono";

const parseDetail = (error: unknown): string => {
  if (Array.isArray(error) && error.length > 0) {
    const [firstIssue] = error;

    if (
      firstIssue &&
      typeof firstIssue === "object" &&
      "message" in firstIssue &&
      typeof firstIssue.message === "string"
    ) {
      return firstIssue.message;
    }
  }

  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues) &&
    error.issues.length > 0
  ) {
    const [firstIssue] = error.issues;

    if (
      firstIssue &&
      typeof firstIssue === "object" &&
      "message" in firstIssue &&
      typeof firstIssue.message === "string"
    ) {
      return firstIssue.message;
    }
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Validation failed";
};

export const invalidRequest = (ctx: Context, detail: unknown) => {
  return ctx.json(
    {
      error: "Invalid request",
      detail: parseDetail(detail),
    },
    400,
  );
};

export const invalidFeedConfig = (ctx: Context, detail: unknown) => {
  return ctx.json(
    {
      error: "Invalid feed configuration",
      detail: parseDetail(detail),
    },
    400,
  );
};

export const unavailableFromGitHub = (ctx: Context, error: unknown) => {
  const headers =
    error &&
    typeof error === "object" &&
    "_tag" in error &&
    error._tag === "GitHubRateLimitError" &&
    "retryAfter" in error &&
    typeof error.retryAfter === "number"
      ? { "Retry-After": String(error.retryAfter) }
      : undefined;

  return ctx.json(
    {
      error: "GitHub temporarily unavailable",
    },
    503,
    headers,
  );
};

export const validationHook = <T>(
  result: { success: boolean; error?: unknown; data?: T },
  ctx: Context,
) => {
  if (!result.success) {
    return invalidRequest(ctx, result.error);
  }

  return undefined;
};
