import type { Context } from "hono";
import type { AppEnv } from "../lib/types";

export const ADAPTIVE_FEED_BUILDER_FLAG = "adaptive-feed-builder";
export const ASSISTANT_INTERPRETER_JEV_FLAG = "assistant-interpreter-jev";
export const EXPERIMENT_KEY_HEADER = "X-Experiment-Key";

export type ExperimentSurface = "local" | "preview" | "production";

const PRODUCTION_FRONTEND_ORIGINS = new Set([
  "https://ossreleasefeed.pages.dev",
  "https://ossreleasefeed.schalkneethling.com",
]);
const PAGES_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.ossreleasefeed\.pages\.dev$/u;
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/u;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1)$/u;
const EXPERIMENT_KEY = /^[A-Za-z0-9_-]{16,128}$/u;

export const isAllowedFrontendOrigin = (origin: string): boolean =>
  PRODUCTION_FRONTEND_ORIGINS.has(origin) ||
  PAGES_PREVIEW_ORIGIN.test(origin) ||
  LOCAL_ORIGIN.test(origin);

export const deriveExperimentSurface = (request: Request): ExperimentSurface => {
  const origin = request.headers.get("Origin") ?? "";
  const requestUrl = new URL(request.url);

  if (LOCAL_HOST.test(requestUrl.hostname) && LOCAL_ORIGIN.test(origin)) {
    return "local";
  }

  if (PAGES_PREVIEW_ORIGIN.test(origin)) {
    return "preview";
  }

  return "production";
};

export const readExperimentKey = (request: Request): string | null => {
  const value = request.headers.get(EXPERIMENT_KEY_HEADER);

  return value && EXPERIMENT_KEY.test(value) ? value : null;
};

// Every experiment flag fails closed: a missing key, a missing binding, or a
// failed evaluation reads as `false`.
const evaluateBooleanFlag = async (ctx: Context<AppEnv>, flag: string): Promise<boolean> => {
  const key = readExperimentKey(ctx.req.raw);

  if (!key || !ctx.env.FLAGS) {
    return false;
  }

  try {
    return await ctx.env.FLAGS.getBooleanValue(flag, false, {
      experimentKey: key,
      surface: deriveExperimentSurface(ctx.req.raw),
    });
  } catch {
    return false;
  }
};

export const evaluateAdaptiveFeedBuilder = (ctx: Context<AppEnv>): Promise<boolean> =>
  evaluateBooleanFlag(ctx, ADAPTIVE_FEED_BUILDER_FLAG);

// Selects the Jev interpreter for a turn; `false` keeps the Llama interpreter.
export const evaluateJevInterpreter = (ctx: Context<AppEnv>): Promise<boolean> =>
  evaluateBooleanFlag(ctx, ASSISTANT_INTERPRETER_JEV_FLAG);
