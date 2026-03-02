# OSSReleaseFeed — Agent Handoff

**Date:** 2026-03-01
**Author:** Schalk Neethling
**Status:** Ready for implementation

---

## What is this project?

OSSReleaseFeed is a web tool that lets users generate RSS/Atom feed URLs for GitHub release activity — either by topic (e.g. `web-components`) or by a user's starred repositories. The feed URL is stateless: all configuration is encoded into it as a base64url token. Users subscribe in their feed reader of choice; no accounts, no database, no stored state.

---

## Three documents to read before starting

| Document | Purpose |
|----------|---------|
| `ossreleasefeed-prd.md` | What is being built and why. Requirements, user flows, acceptance criteria, success metrics. |
| `ossreleasefeed-technical-spec.md` (v1.3) | How it is built. Architecture, tooling decisions, data model, API design, feed generation, security, CI/CD, deployment. All open questions are resolved. |
| `ossreleasefeed-implementation-plan.md` (v1.3) | Sequenced build plan. Eight phases with tasks, gates, and definition of done. Start here for task order. |

---

## Architecture in one paragraph

A React 19 SPA (Vite, standard CSS, no third-party component library) is hosted on Cloudflare Pages. All backend logic lives in a single Cloudflare Worker (Hono router, TypeScript, Effect). The Worker uses Effect for schema validation (`Schema`), typed error handling (`Data.TaggedError`), service composition (`Context.Tag`/`Layer`), and concurrent fan-out (`Effect.all`). It generates Atom feeds from GitHub's REST API and per-repo `releases.atom` feeds, caches responses at the edge using the Cloudflare Cache API, and is the only server in the system. No origin, no database, no sessions.

---

## Key constraints to internalise before touching code

**Workers Paid plan is mandatory.** The free plan caps at 50 external subrequests per invocation. Worst-case topic fan-out is 125 GitHub API calls. It fails hard on the free plan.

**`@octokit/rest` only — never the full `octokit` package.** The full package's throttling plugin fires `setTimeout` at module scope, which the Workers runtime rejects. Always instantiate Octokit inside the `fetch` handler, never at module scope.

**Effect Layers must be constructed per request, inside the `fetch` handler.** The `env` object (containing `GITHUB_PAT` and other bindings) is only available at request time — not at module scope. Build the `Layer` inside the Hono handler, then run `Effect.provide` before `Effect.runPromise`. Never construct a Layer at module scope using env values.

**`<link rel="alternate" href>` is the feed diffing key, not `<id>`.** GitHub's Atom `<id>` is a tag URI (`tag:github.com,2008:Repository/...`), not a URL. Use the entry's link URL as the stable identifier for incremental update diffing.

**Entity decoding is free.** `sax` (already in the dependency tree via the `feed` package) decodes HTML entities when parsing Atom XML. Do not add `html-entities` or any separate decode step — the content extracted from `<entry><content>` is already decoded HTML, ready for `HTMLRewriter` sanitisation.

**No `html-entities` dependency.** The package is unmaintained (security PRs sitting since 2022). It is also unnecessary — see the point above.

**Bun locally, Node.js 22 in CI, Wrangler for bundling.** Do not use `bun build` for the Worker — Wrangler's esbuild handles `workerd` conditional exports correctly; Bun's bundler does not. Wrangler in CI runs via `npx` or `wrangler-action`, not via Bun's runtime.

**HTML sanitisation pipeline:** `sax` parses Atom XML (entities decoded) → `HTMLRewriter` (built-in, no library) strips unsafe tags and `on*` attributes. No DOMPurify, no HTML Sanitizer API — neither is available in the Workers V8 isolate.

---

## Phase sequence at a glance

| Phase | Goal |
|-------|------|
| 1 | Repo, CI, linting, test infrastructure, frontend and Worker scaffolds. No product code. |
| 2 | Core Worker: spike validates `@octokit/rest` + `effect` bundle (2.1), then schemas, GitHub client (Effect service layer), feed generation, diffing, all API routes, security headers. |
| 3 | Core frontend: full topic and starred repo flows, accessibility, responsive layout. |
| 4 | P1 features: validation review, Sentry + Umami activation. |
| 5 | Beta: production deploy, smoke testing, metrics baseline. |
| 6 | Public launch: blog post, announcement. |
| 7 | JSON Feed output (`feed.json1()` — one method call, already supported by the `feed` package). |
| 8 | P2: QR code, feed preview. |

Do not begin a phase until the previous phase's gate criteria are met.

---

## Non-negotiables (apply to every task)

- Tests written alongside implementation, not after.
- Accessibility at point of build, not audited at the end.
- No hardcoded values — all design tokens in `tokens.css` as CSS custom properties.
- Semantic HTML. Native elements over ARIA re-purposing.
- Schema decoding (`Schema.decodeUnknownEither`) is the first operation at every data boundary. Invalid input returns HTTP 400 before any GitHub call is made.
- All TypeScript types are inferred from Effect schemas (`Schema.Schema.Type<typeof Schema>`). No hand-written interfaces for validated data.
- All expected failure cases are typed errors (`Data.TaggedError`). No raw try/catch in Worker business logic — wrap fallible operations in `Effect.tryPromise` and map to a typed error class.
- Explicit over clever. Readable over shorter.
