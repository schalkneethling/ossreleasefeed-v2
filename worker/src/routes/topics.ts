import { Hono } from "hono";

export const topicsRoutes = new Hono();

topicsRoutes.get("/featured", (ctx) => {
  return ctx.json(
    {
      error: "Not Implemented",
      route: "GET /api/topics/featured",
    },
    501,
  );
});

topicsRoutes.get("/validate", (ctx) => {
  return ctx.json(
    {
      error: "Not Implemented",
      route: "GET /api/topics/validate",
    },
    501,
  );
});
