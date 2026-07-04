import type { Context } from "hono";

const parseDetail = (error: unknown): string => {
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

export const validationHook = <T>(
  result: { success: boolean; issues?: unknown; output?: T },
  ctx: Context,
) => {
  if (!result.success) {
    return invalidRequest(ctx, result.issues);
  }

  return undefined;
};
