import { Hono } from "hono";
import { evaluateAdaptiveFeedBuilder } from "../assistant/experiment";
import type { AppEnv } from "../lib/types";

export const experimentsRoutes = new Hono<AppEnv>();

experimentsRoutes.get("/", async (ctx) => {
  const adaptiveFeedBuilder = await evaluateAdaptiveFeedBuilder(ctx);

  return ctx.json({ adaptiveFeedBuilder }, 200, {
    "Cache-Control": "no-store",
  });
});
