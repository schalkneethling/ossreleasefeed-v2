import { Hono } from "hono";

export const feedRoutes = new Hono();

feedRoutes.get("/:config", (ctx) => {
  return ctx.json(
    {
      error: "Not Implemented",
      route: "GET /feed/:config",
    },
    501,
  );
});
