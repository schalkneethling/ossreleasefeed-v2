import { Hono } from "hono";

export const starredRoutes = new Hono();

starredRoutes.get("/:username", (ctx) => {
  return ctx.json(
    {
      error: "Not Implemented",
      route: "GET /api/starred/:username",
    },
    501,
  );
});
