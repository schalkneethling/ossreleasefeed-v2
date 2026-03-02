import { Hono } from "hono";

export const usersRoutes = new Hono();

usersRoutes.get("/validate/:username", (ctx) => {
  return ctx.json(
    {
      error: "Not Implemented",
      route: "GET /api/users/validate/:username",
    },
    501,
  );
});
