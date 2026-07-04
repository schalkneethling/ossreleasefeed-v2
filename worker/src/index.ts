import { Octokit } from "@octokit/rest";
import { Hono } from "hono";
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

  ctx.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://cloud.umami.is",
  );
  ctx.res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  ctx.res.headers.set("X-Content-Type-Options", "nosniff");
  ctx.res.headers.set("X-Frame-Options", "DENY");
});

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
