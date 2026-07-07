import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
  server: {
    // Local dev: API calls stay same-origin and are proxied to `wrangler dev`.
    // Deployed builds set VITE_WORKER_URL instead (see lib/api.ts).
    proxy: {
      "/api": "http://localhost:8787",
      "/feed": "http://localhost:8787",
    },
  },
});
