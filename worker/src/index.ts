import { Octokit } from "@octokit/rest";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { assistantRoutes } from "./routes/assistant";
import { experimentsRoutes } from "./routes/experiments";
import { feedRoutes } from "./routes/feed";
import { starredRoutes } from "./routes/starred";
import { topicsRoutes } from "./routes/topics";
import { usersRoutes } from "./routes/users";
import type { AppEnv } from "./lib/types";
import { makeGitHubLayer } from "./github/client";
import { sentryOptions } from "./lib/sentry";
import { isAllowedFrontendOrigin } from "./assistant/experiment";

export const app = new Hono<AppEnv>();

app.use("*", async (ctx, next) => {
  const octokit = new Octokit({
    auth: ctx.env.GITHUB_PAT,
  });

  ctx.set("githubLayer", makeGitHubLayer(octokit));

  await next();
});

app.use("*", async (ctx, next) => {
  await next();

  const response = new Response(ctx.res.body, ctx.res);

  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://cloud.umami.is",
  );
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  ctx.res = response;
});

// pages.dev stays allowed alongside the custom domain since Cloudflare Pages
// doesn't disable it once a custom domain is attached.
// The SPA is served by Cloudflare Pages on a different origin, so the /api/*
// routes it calls need CORS. /feed/* is consumed by feed readers, not
// browsers, and stays CORS-free.
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (isAllowedFrontendOrigin(origin)) {
        return origin;
      }

      return null;
    },
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Content-Type", "X-Experiment-Key"],
    exposeHeaders: ["Retry-After"],
    maxAge: 86400,
  }),
);

app.route("/feed", feedRoutes);
app.route("/api/assistant", assistantRoutes);
app.route("/api/experiments", experimentsRoutes);
app.route("/api/topics", topicsRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/starred", starredRoutes);

app.get("/", (ctx) => {
  return ctx.text("OSSReleaseFeed worker scaffold");
});

export default Sentry.withSentry(sentryOptions, {
  fetch(request: Request, env: AppEnv["Bindings"], executionContext: ExecutionContext) {
    return app.fetch(request, env, executionContext);
  },
});
