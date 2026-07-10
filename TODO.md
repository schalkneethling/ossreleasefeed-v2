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

- [x] Frontend: `https://ossreleasefeed.pages.dev` — set in `worker/src/index.ts`
- [x] Worker: `https://ossreleasefeed-worker.volume4-schalk.workers.dev` — set in `frontend/public/_headers`
- [x] Pages project name is `ossreleasefeed`, so the preview-origin regex in
      `worker/src/index.ts` (`*.ossreleasefeed.pages.dev`) is already correct.

## 3. Cloudflare — unblocks first deploy

- [ ] Confirm the account is on **Workers Paid** ($5/mo). Hard requirement:
      topic fan-out can hit 125 subrequests; the free plan caps at 50.
- [ ] Set the Worker's runtime secret: `cd worker && pnpm exec wrangler secret put GITHUB_PAT`
      (can reuse the same fine-grained PAT as local dev).
- [ ] Create the Cloudflare Pages project (connect it to this repo,
      build command `pnpm run build:frontend`, output `frontend/dist`).
- [ ] Set Pages env var (project level, applies to previews too):
      `VITE_WORKER_URL` = the Worker's public URL (workers.dev URL is fine
      until the custom domain exists).
- [ ] Set Pages env var `VITE_UMAMI_WEBSITE_ID` = website id from item 5.
- [ ] Set Pages env var `VITE_E2E_TEST_HOOKS` = `true`, scoped to the
      **Preview** environment only (leave unset for Production). This
      enables the `?__throw=1` ErrorBoundary trigger used by
      `tests/e2e/error-boundary.spec.ts`, which the e2e workflow (item 4)
      runs against PR preview deployments — without this it stays
      unreachable everywhere, including in CI.
- [ ] Later (pre-launch, Phase 5): add the custom domain to the Worker,
      disable the workers.dev route (WAF rules do not apply on workers.dev),
      and add the domain to Pages.

## 4. GitHub repository settings — unblocks deploy workflow and CI e2e

- [ ] Secrets → Actions: `CLOUDFLARE_API_TOKEN` (token with Workers + Pages
      edit permissions) and `CLOUDFLARE_ACCOUNT_ID`. The e2e workflow job
      skips while either is unset — that is why the "e2e" check shows as
      SKIPPED on PRs today.
      The workflow looks up each PR's own Cloudflare Pages preview
      deployment via the Pages API and points Playwright at it directly —
      no static `PLAYWRIGHT_BASE_URL` variable needed.

## 5. Umami (analytics)

- [ ] Create the site in Umami Cloud for the production domain; copy the
      website id into the Pages `VITE_UMAMI_WEBSITE_ID` env var (and into
      1Password vault `dev` as `ossreleasefeed-umami-website-id` if you also
      want it resolved locally — then update `.env.schema` to reference it).

## 6. Sentry (Phase 4 activation)

- [ ] Create two Sentry projects (frontend React, worker Cloudflare).
- [ ] Frontend DSN → Pages env var `VITE_SENTRY_DSN`; Worker DSN →
      `cd worker && pnpm exec wrangler secret put SENTRY_DSN` (DSNs are
      public-safe, but the secret store is the tidiest place for it).

---

Already handled in code (no action needed): Vite dev proxy to
`wrangler dev`, `VITE_WORKER_URL` fallback in `frontend/src/lib/api.ts`,
CORS middleware on `/api/*`, Pages `_headers` security headers, and the
varlock schema/scripts.
