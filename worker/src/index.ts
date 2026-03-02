import { Hono } from "hono";
import { feedRoutes } from "./routes/feed";
import { starredRoutes } from "./routes/starred";
import { topicsRoutes } from "./routes/topics";
import { usersRoutes } from "./routes/users";

const app = new Hono();

app.route("/feed", feedRoutes);
app.route("/api/topics", topicsRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/starred", starredRoutes);

app.get("/", (ctx) => {
  return ctx.text("OSSReleaseFeed worker scaffold");
});

export default app;
