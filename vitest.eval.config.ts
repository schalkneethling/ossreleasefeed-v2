import { defineConfig } from "vitest/config";

// Offline model evaluation. Never part of `pnpm test` or CI: it is only reachable
// through `pnpm run eval:assistant`, and the suite skips without credentials.
export default defineConfig({
  server: {
    host: "127.0.0.1",
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/eval/**/*.eval.ts"],
    testTimeout: 300_000,
  },
});
