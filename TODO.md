# Account setup & secrets — action items

Things only you can do (accounts, secrets, dashboard config). Code-side
wiring that depends on an item is noted inline. Items are roughly ordered;
the first two unblock local dev, the rest unblock beta deploy (Phase 5).

## 1. Local dev secrets (varlock + 1Password) — unblocks `pnpm run dev:worker`

Varlock is already wired up: `.env.schema` (committed) resolves secrets from
1Password at run time; nothing secret is written to disk. `pnpm run dev:worker`
wraps `wrangler dev` with `varlock run` and passes `GITHUB_PAT` as a Worker
binding.

- [ ] Install the [1Password CLI](https://developer.1password.com/docs/cli/get-started/)
      (`brew install 1password-cli`) and enable the desktop-app integration:
      1Password app → Settings → Developer → "Integrate with 1Password CLI".
      Varlock authenticates through this (biometric unlock) — no service
      account needed for local dev.
- [ ] Create a GitHub personal access token for the Worker: fine-grained,
      **public repository read access only**, no other permissions.
- [ ] Save it in 1Password: vault `dev`, item named `ossreleasefeed-github-pat`,
      with the token in a field named `credential` (the API Credential item
      category has this field by default). The schema reference is
      `op://dev/ossreleasefeed-github-pat/credential`.
- [ ] Verify: `pnpm exec varlock load` from the repo root should show GITHUB_PAT
      as resolved (redacted), then `pnpm run dev:worker` should start clean.

## 2. Production URLs (resolved)

- [x] Frontend: `https://ossreleasefeed.pages.dev` and custom domain
      `https://ossreleasefeed.schalkneethling.com` — both allow-listed in
      `worker/src/index.ts`
- [x] Worker: `https://ossreleasefeed-worker.volume4-schalk.workers.dev` — set in `frontend/public/_headers`
- [x] Pages project name is `ossreleasefeed`, so the preview-origin regex in
      `worker/src/index.ts` (`*.ossreleasefeed.pages.dev`) is already correct.

## 3. Cloudflare — unblocks first deploy

- [ ] Confirm the account is on **Workers Paid** ($5/mo). Still on the free
      plan as of beta launch. Most feeds stay well under the free plan's
      50-subrequest cap — `MAX_REPOS`/`MAX_REPOS_ALL_ACTIVITY` in
      `worker/src/feed/generate.ts` already bound repo count for exactly
      this reason. The one combination that still exceeds it: a topics feed
      using the "or" operator with all 5 topics selected and activity type
      "all" — up to 5 search subrequests plus 24 repos × 2 (releases +
      issues) = ~53. That specific config gets a 503 with no stale-cache
      fallback (the fallback in `routes/feed.ts` only covers
      `GitHubRateLimitError`, not a Workers subrequest-limit exception).
      Fine to defer for beta with a notice about the edge case; upgrading
      removes it entirely.
- [x] Set the Worker's runtime secret: `cd worker && pnpm exec wrangler secret put GITHUB_PAT`.
- [x] Create the Cloudflare Pages project (connect it to this repo,
      build command `pnpm run build:frontend`, output `frontend/dist`).
- [x] Set Pages env var (project level, applies to previews too):
      `VITE_WORKER_URL` = the Worker's public URL.
- [x] Set Pages env var `VITE_UMAMI_WEBSITE_ID` = website id from item 5.
- [x] Set Pages env var `VITE_E2E_TEST_HOOKS` = `true`, scoped to the
      **Preview** environment only. Enables the `?__throw=1` ErrorBoundary
      trigger used by `tests/e2e/error-boundary.spec.ts`.
- [x] Custom domain added to Pages: `ossreleasefeed.schalkneethling.com`.
- [ ] Deferred: custom domain for the Worker (`ossreleasefeed-api.schalkneethling.com`
      or similar). Unlike Pages, Workers Custom Domains require the zone to
      be on Cloudflare nameservers — no CNAME-only path — so this means
      migrating `schalkneethling.com`'s nameservers to Cloudflare, not just
      adding one record. Worth doing eventually since WAF rules don't apply
      on workers.dev, but deliberately deferred for now.

## 4. GitHub repository settings — unblocks deploy workflow and CI e2e

- [x] Secrets → Actions: `CLOUDFLARE_API_TOKEN` (token with Workers Edit,
      for `deploy.yml`, and Pages Read, for the e2e workflow's deployment
      lookup — it only reads deployment status, never writes) and
      `CLOUDFLARE_ACCOUNT_ID`.
      The workflow looks up each PR's own Cloudflare Pages preview
      deployment via the Pages API and points Playwright at it directly —
      no static `PLAYWRIGHT_BASE_URL` variable needed.

## 5. Umami (analytics)

- [x] Create the site in Umami Cloud for the production domain; copy the
      website id into the Pages `VITE_UMAMI_WEBSITE_ID` env var (and into
      1Password vault `dev` as `ossreleasefeed-umami-website-id` if you also
      want it resolved locally — then update `.env.schema` to reference it).

## 6. Sentry (Phase 4 activation)

- [x] Create two Sentry projects (frontend React, worker Cloudflare).
- [x] Frontend DSN → Pages env var `VITE_SENTRY_DSN`; Worker DSN →
      `cd worker && pnpm exec wrangler secret put SENTRY_DSN` (DSNs are
      public-safe, but the secret store is the tidiest place for it).

---

Already handled in code (no action needed): Vite dev proxy to
`wrangler dev`, `VITE_WORKER_URL` fallback in `frontend/src/lib/api.ts`,
CORS middleware on `/api/*`, Pages `_headers` security headers, and the
varlock schema/scripts.
