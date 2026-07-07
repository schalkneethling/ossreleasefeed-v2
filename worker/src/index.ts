import { Octokit } from "@octokit/rest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { feedRoutes } from "./routes/feed";
import { starredRoutes } from "./routes/starred";
import { topicsRoutes } from "./routes/topics";
import { usersRoutes } from "./routes/users";
import type { AppEnv } from "./lib/types";
import { makeGitHubLayer } from "./github/client";

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

// TODO(schalkneethling): replace with the real production frontend origin
// once the domain is decided — tracked in TODO.md.
const PRODUCTION_FRONTEND_ORIGIN = "https://ossreleasefeed.example";
const PAGES_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.ossreleasefeed\.pages\.dev$/u;

// The SPA is served by Cloudflare Pages on a different origin, so the /api/*
// routes it calls need CORS. /feed/* is consumed by feed readers, not
// browsers, and stays CORS-free.
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (origin === PRODUCTION_FRONTEND_ORIGIN || PAGES_PREVIEW_ORIGIN.test(origin)) {
        return origin;
      }

      return null;
    },
    allowMethods: ["GET"],
    maxAge: 86400,
  }),
);

app.route("/feed", feedRoutes);
app.route("/api/topics", topicsRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/starred", starredRoutes);

app.get("/", (ctx) => {
  return ctx.text("OSSReleaseFeed worker scaffold");
});

export default {
  fetch(request: Request, env: AppEnv["Bindings"], executionContext: ExecutionContext) {
    return app.fetch(request, env, executionContext);
  },
};
