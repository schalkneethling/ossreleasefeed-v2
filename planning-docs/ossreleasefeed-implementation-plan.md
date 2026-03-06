# OSSReleaseFeed — Implementation Plan

**Version:** 1.0  
**Date:** 2026-02-28  
**Author:** Schalk Neethling  
**Status:** Draft  
**Informed by:** PRD v1.1 · Technical Specification v1.2

---

## Purpose

This document is the hand-off reference for implementation. It translates the PRD and technical specification into a sequenced build plan with clear phase gates, task breakdowns, and the definition of done for each phase. It is not a project management tool — it does not assign owners or set dates. It is a map.

---

## Guiding Principles

These apply to every task in every phase. They are not repeated per task — they are assumed.

- Write tests before or alongside implementation, not after. Acceptance criteria in the PRD map directly to test cases.
- No code merges to `main` without passing CI. The CI pipeline is not a formality.
- Accessibility is implemented at the point of building each component, not audited at the end.
- Feedback proximity applies to every interactive element — validation, loading, errors, and confirmations surface adjacent to the element that triggered them.
- Explicit over clever. Readable over shorter. Be kind to future Schalk.
- Do not begin a new phase until the current phase's gate criteria are met.

---

## Pre-Implementation: Resolved Open Questions

All open questions from the PRD have been resolved prior to implementation — no exploratory spike phase is needed before Phase 1. The findings are summarised here for reference; full detail is in the technical specification Open Questions section.

- **OQ-1 (Build pipeline):** Bun locally, Wrangler for bundling/deployment, Node.js 22 in CI. Confirmed.
- **OQ-2 (Topic Atom feeds + `feed` package):** `github.com/topics/{topic}.atom` does not exist. Topic feeds use a fan-out pipeline. The `feed` npm package is confirmed Workers-compatible. Confirmed.
- **OQ-3 (Author data):** `<author><n>` present on every `releases.atom` entry. `issue.user.login` stable in the REST API. Confirmed.
- **OQ-4 (Fan-out feasibility):** Constraint is the Workers subrequest limit, not GitHub rate limits. Workers Paid plan (10,000 subrequests/invocation) is required — the free plan's 50-subrequest cap fails at worst-case fan-out. **Workers Paid ($5/month) is a hard deployment requirement.**
- **OQ-5 (HTML sanitisation):** `HTMLRewriter` (built-in) is the correct approach. No additional library needed — `sax` handles entity decoding as part of XML parsing. DOMPurify and the HTML Sanitizer API are unavailable in the V8 isolate.

The one remaining validation — confirming `@octokit/rest` bundles and deploys cleanly — is task 2.1 in Phase 2, run against the real scaffolded project after Phase 1 is complete.

---

## Phase 1 — Project Initialisation

**Goal:** A working repository with CI, linting, testing infrastructure, and deployment pipeline in place before a single line of product code is written.

### Tasks

**1.1 — Repository & workspace setup**

- Initialise a Bun workspace monorepo with `frontend/` and `worker/` packages
- Configure root `tsconfig.json` with project references; enable strict mode
- Commit `.gitignore`, `README.md` (brief project description, link to PRD), `LICENSE`

**1.2 — Linting & formatting**

- Install and configure Oxlint (`.oxlintrc.json`) — TypeScript, React, and jsx-a11y equivalent rules
- Install and configure Stylelint (`.stylelintrc.json`) with the following:
  - Extends `stylelint-config-standard`
  - `stylelint-plugin-logical-css` — enforces logical properties, values, and units
  - `stylelint-selector-bem-pattern` — enforces BEM naming on all class selectors
  - `stylelint-order` — `order/properties-alphabetical-order`
  - `media-feature-range-notation: "context"` — enforces modern range syntax for media queries
  - `selector-class-pattern` — disallows `js-` prefixed class names in CSS (reserved for JavaScript hooks only)
  - Full configuration is defined in the technical specification
- Install and configure Oxfmt (`.oxfmt.toml`)
- Add `lint`, `format`, and `format:check` scripts to `package.json`
- Verify all three tools run cleanly on the empty project

**1.3 — Testing infrastructure**

- Install Vitest; configure `vitest.config.ts` for unit and integration test suites
- Install the `effect` package; confirm it is available in the Worker bundle — the bundle check is part of the Phase 2.1 spike, but the package should be installed at scaffolding time so it is available from task 2.2 onward
- Install MSW v2; create `tests/integration/setup.ts` with `setupServer` from `msw/node`; configure `beforeAll`, `afterEach`, `afterAll` lifecycle hooks with `onUnhandledRequest: 'error'`; register the setup file in `vitest.config.ts`
- Create `tests/integration/handlers.ts` as the home for all GitHub API mock handlers
- Install Playwright; configure `playwright.config.ts` targeting the Cloudflare Pages preview URL (environment variable `PLAYWRIGHT_BASE_URL`)
- Install `@axe-core/playwright`
- Create placeholder test files in `tests/unit/`, `tests/integration/`, `tests/e2e/` to confirm the runners execute

**1.4 — Frontend scaffold**

- Scaffold the React SPA with Vite in `frontend/`
- Enable React Compiler in `vite.config.ts`
- Create `frontend/src/styles/tokens.css` — define all design tokens as CSS custom properties (colours, spacing, typography scale, radii, transition durations); no values elsewhere in the codebase should be hardcoded
- Confirm `bun run dev` starts the Vite dev server and the browser renders the default React page

**1.5 — Worker scaffold**

- Scaffold a Hono Worker in `worker/`
- Define all routes as stubs returning `501 Not Implemented`:
  - `GET /feed/:config`
  - `GET /api/topics/featured`
  - `GET /api/topics/validate`
  - `GET /api/users/validate/:username`
  - `GET /api/starred/:username`
- Configure `wrangler.toml`; confirm `wrangler dev` starts the local Worker

**1.6 — GitHub Actions CI**

- Create `.github/workflows/ci.yml`:
  - Triggers: `pull_request`, `push` to `main`
  - Steps: lint → type check → unit tests → integration tests → build (frontend + worker)
- Create `.github/workflows/e2e.yml`:
  - Triggers: `pull_request` (after Cloudflare Pages preview is ready)
  - Steps: wait for preview URL → Playwright E2E → axe-core accessibility audit
- Create `.github/workflows/deploy.yml`:
  - Triggers: `push` to `main`
  - Steps: `wrangler deploy` (Cloudflare Pages deploys automatically)

**1.7 — GitHub security tooling**

- Create `.github/dependabot.yml` — weekly npm updates + GitHub Actions updates
- Enable CodeQL analysis via GitHub repository settings or workflow file
- Configure Socket Security via the GitHub App

**1.8 — Monitoring & analytics scaffolding**

- Install `@sentry/react` in `frontend/`; install `@sentry/cloudflare` in `worker/`
- Add Sentry DSN as environment variables (not secrets — DSNs are public-safe); configure source map upload in the Vite and Wrangler build steps
- Add Umami script tag to `frontend/index.html`; define the event tracking helper in `frontend/src/lib/analytics.ts` (wraps `window.umami.track` with a no-op fallback)
- Neither Sentry nor Umami need to be functional yet — scaffolding and configuration is sufficient at this phase

### Phase 1 Gate

- CI runs green on an empty commit
- `bun run lint`, `bun run test`, and `bun run build` all pass locally
- A pull request to `main` triggers the full CI workflow
- Dependabot, CodeQL, and Socket Security are active on the repository

---

## Phase 2 — Core Worker (P0 Backend)

**Goal:** A functioning feed generation Worker that produces valid Atom XML for both topic and starred repo feeds, with edge caching and correct error handling. No frontend yet.

### Tasks

**2.1 — Spike: bundle validation for `@octokit/rest` and `effect`**
Before writing any production Worker code, confirm both key dependencies bundle and deploy cleanly inside the real scaffolded project. This is a go/no-go check — remove all test code before moving on.

- Install `@octokit/rest` and `effect`. Instantiate Octokit **inside** the `fetch` handler (never at module scope). Make a single GitHub API call (e.g. list public repos for a user). Run `wrangler deploy --dry-run` and confirm a clean bundle.
- Install `@hono/standard-validator`. Write a minimal Hono route that uses `sValidator` with an Effect Schema. Confirm it type-checks and the route validates correctly.
- Construct a `Layer` inside the `fetch` handler, provide it to a minimal `Effect.runPromise` call, and confirm the per-request pattern works without runtime errors (specifically: no "I/O outside fetch handler" errors from the Workers runtime).
- If any step fails, resolve the issue before any further Phase 2 tasks begin.

**2.2 — Effect schemas + inferred types**

- Create `worker/src/lib/schemas.ts` as the single source of truth for all validated data shapes
- Import from `effect`: `Schema`, `Data`, `Either`
- Define `GithubUsernameSchema` and `TopicSlugSchema` using `Schema.String.pipe(Schema.pattern(...))` — these are the primitive reusable schemas imported by both the `FeedConfig` decoder and route handlers
- Define `FeedConfigSchema` using `Schema.Union(Schema.Struct({...}), Schema.Struct({...}))` — each struct has a `source: Schema.Literal(...)` discriminant; TypeScript narrows automatically. Use `Schema.optionalWith(..., { default: () => value })` for fields with known defaults (`topicOperator`, `format`)
- Define `FeedEntrySchema` using `Schema.Struct` — `id` and `link` must be non-empty URL strings, `date` is `Schema.Date`, all required string fields use `Schema.NonEmptyString`
- Define Effect schemas for all GitHub API responses: releases, issues, starred repos, topic search results, user validation response
- All TypeScript types are inferred using `Schema.Schema.Type<typeof Schema>` — no hand-written interfaces for any validated data shape
- Implement `encodeFeedConfig(config: FeedConfig): string` — deterministic JSON serialisation (alphabetically sorted keys) + base64url encoding
- Implement `decodeFeedConfig(token: string): Either.Either<FeedConfig, ParseError>` — base64url decoding + JSON parsing + `Schema.decodeUnknownEither(FeedConfigSchema)`; callers check `Either.isLeft` and handle the failure branch explicitly
- Write Vitest unit tests: valid configs round-trip correctly; malformed tokens return `Left`; missing required fields fail; TTL below minimum fails; invalid username patterns fail; `FeedEntry` with empty id, non-URL id, or missing date fails schema validation
- Write Vitest unit tests for route-level sanitisation: valid and invalid username patterns against `GithubUsernameSchema`; valid and invalid topic slugs against `TopicSlugSchema`; path traversal attempts and injected characters return `Left`

**2.3 — GitHub API client (Effect service)**

- Install `@octokit/rest` — **not** the full `octokit` package. See the constraint documented in the tech spec: the full package bundles `@octokit/plugin-throttling`, which calls `setTimeout` at module scope, rejected by the Workers runtime.
- Define the `GitHubClient` service using `Context.Tag` (from `effect`) — this is an interface tag, not an implementation. The interface exposes only the methods needed by this project, all returning `Effect` values with typed errors:
  - `getFeaturedTopics(): Effect.Effect<Topic[], GitHubNetworkError>`
  - `validateTopic(slug: string): Effect.Effect<boolean, GitHubNetworkError>`
  - `validateUsername(username: string): Effect.Effect<{ exists: boolean; hasStars: boolean }, GitHubNetworkError>`
  - `getStarredRepos(username: string): Effect.Effect<Repo[], GitHubRateLimitError | GitHubNetworkError>`
  - `getRepoReleases(owner: string, repo: string): Effect.Effect<Release[], GitHubRateLimitError | GitHubNetworkError>`
  - `getRepoIssues(owner: string, repo: string): Effect.Effect<Issue[], GitHubRateLimitError | GitHubNetworkError>`
- Implement `makeGitHubClient(octokit: Octokit): GitHubClientService` — wraps `@octokit/rest` calls in `Effect.tryPromise`, mapping thrown errors to the appropriate typed error classes
- Define the typed error classes using `Data.TaggedError` (see tech spec Effect Architecture section): `GitHubRateLimitError`, `GitHubNotFoundError`, `GitHubNetworkError`, `FeedParseError`
- **Construct the `Layer` per request, inside the Hono handler — never at module scope.** The `env` object (containing `GITHUB_PAT`) is only available inside the `fetch` handler. See the Workers-Specific: Per-Request Layer Construction section of the tech spec for the correct pattern.
- Rate limit retries use `Effect.retry` with `Schedule.exponential` — no throttling plugin needed. Inspect `retry-after` response headers in the error handler to seed the initial back-off duration.
- Integration tests for all GitHub API interactions use MSW (`msw/node`) to intercept at the fetch level — no mock clients, no special Effect test utilities needed. MSW works because Octokit uses `fetch` internally.

**2.4 — Feed serialisation**

- Install the `feed` package (`jpmonette/feed`) — Workers V8 isolate compatibility confirmed during OQ-2
- Implement `buildFeed(config: FeedConfig, entries: FeedEntry[], feedUrl: string): Feed` — populates a `Feed` instance with the correct metadata and all entries; does not serialise
- Each `FeedEntry` is validated against the Effect `FeedEntrySchema` before being added; invalid entries are logged and skipped rather than causing the entire feed generation to fail
- Entry titles follow the format `[owner/repo] Type: title` (e.g. `[whatwg/html] Release: 2024-01-15`)
- Entry `id` is always the GitHub URL of the source content — never generated at call time
- Feed-level `updated` is the most recent entry date — never `new Date()` at call time
- HTML in summaries is sanitised using the approach confirmed in OQ-5 before being passed to the library
- Callers invoke `feed.atom1()` for Atom output; `feed.json1()` for JSON Feed (REQ-013)
- Write Vitest integration tests: given fixed `FeedEntry` fixtures passing the Effect schema, `buildFeed` → `feed.atom1()` produces well-formed Atom XML; assert on specific field values (id, title, updated) rather than on raw XML structure

**2.5 — Feed diffing (incremental updates)**

- Implement `diffFeed(cachedFeed: string | null, freshEntries: FeedEntry[]): FeedEntry[]`
- If `cachedFeed` is null (no prior cache), return all fresh entries
- Parse the cached feed, extract all entry `<link rel="alternate" href>` URL values into a Set — use this URL as the stable key, not GitHub's tag URI `<id>` (e.g. `tag:github.com,2008:Repository/...`), which is not a plain URL; return only entries whose link URL is not present in the cached Set
- Write Vitest unit tests: no cached feed returns all entries; all entries already in cache returns empty array; partial overlap returns only new entries

**2.6 — Worker route: `/feed/:config`**

- First operation in the handler: decode and `v.safeParse` the config token against `FeedConfigSchema`; return HTTP 400 with a JSON error body on failure — no other processing occurs
- Wire up feed generation for valid configs
- Implement caching with the Cloudflare Cache API
- Handle rate limit 429 response from GitHub: return cached feed + `Retry-After` header; if no cached feed exists, return 503
- Handle GitHub API unavailable: return cached feed if available, otherwise 503 with human-readable error
- Write Vitest integration tests for each response path: valid config produces Atom output; malformed base64url returns 400; structurally valid JSON that fails schema constraints returns 400; rate limit 429 returns cached feed; no cache + GitHub down returns 503

**2.7 — Worker routes: `/api/*`**

- All handlers validate URL parameters and query strings with `v.safeParse` using the schemas defined in 2.1 as the very first operation — before any cache lookup, GitHub call, or other logic; invalid input returns HTTP 400 immediately
- Implement `/api/topics/featured` — proxy + cache 24 hours; no user input to validate
- Implement `/api/topics/validate` — validate `q` query param against `TopicSlugSchema`; proxy + cache 1 hour; return `{ exists: boolean, name: string | null }`
- Implement `/api/users/validate/:username` — validate `:username` against `GithubUsernameSchema`; proxy `/users/{username}`; return `{ exists: boolean, username: string | null, hasStars: boolean }`; cache 5 minutes
- Implement `/api/starred/:username` — validate `:username` against `GithubUsernameSchema`; proxy; fetch all pages up to 100 repos; cache 1 hour; return 404 for unknown usernames
- Parse all GitHub API responses through their Effect schemas (`Schema.decodeUnknownEither`) before mapping — malformed or unexpected response shapes are caught here, not downstream
- Write Vitest integration tests for each route: valid inputs with mocked GitHub responses; invalid inputs (bad username patterns, bad topic slugs, path traversal attempts) return 400 before any GitHub call is made

**2.8 — Security headers**

- Add middleware to Hono that attaches security headers to all responses:
  - `Content-Security-Policy` (restrictive; relax as frontend needs dictate)
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`

### Phase 2 Gate

- `GET /feed/{config}` returns valid Atom 1.0 XML for a topic config and a starred repo config
- Feed entries pass Effect schema validation before serialisation; invalid entries are skipped with a log, not a crash
- Cache hit returns the cached response; cache miss fetches from GitHub and populates the cache
- Rate limit 429 returns the cached feed + `Retry-After`
- Malformed config returns HTTP 400
- All Vitest unit and integration tests pass in CI
- `@octokit/rest` and `effect` spike (task 2.1) confirmed clean: both packages bundle without errors, `sValidator` type-checks with Effect Schema, and per-request Layer construction runs without Workers runtime errors

---

## Phase 3 — Core Frontend (P0 UI)

**Goal:** A working React SPA that walks the user through the full topic and starred repo feed creation flows, communicates correctly with the Worker, and meets WCAG 2.1 AA.

### Tasks

**3.1 — Design direction & token definition**
Before writing a single component, read and apply the [Anthropic Frontend Design Skill](https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/frontend-design/SKILL.md). Commit to a clear aesthetic direction — typography, colour palette, tone — and document it as a comment at the top of `tokens.css`. Then define all design tokens based on that direction.

- Read the Anthropic Frontend Design Skill in full before making any design decisions
- Choose and document the aesthetic direction (typography, colour palette, tone) as a comment in `tokens.css`
- Define all tokens as CSS custom properties: colour palette (background, surface, border, text, accent, error, success), type scale, spacing scale, border radii, transition durations
- No hardcoded values anywhere else in the CSS

This task gates all component implementation. Do not begin task 3.2 until the design direction is locked and tokens are defined.

**3.2 — Layout & landing page**

- Implement the single-column page shell: `<header>`, `<main>`, `<footer>`
- Implement the landing page state: headline, brief description, "Create feed" `<button>`
- No mode selection is visible until "Create feed" is clicked
- Playwright E2E test: landing page renders; "Create feed" button is present and focusable

**3.3 — Mode selection**

- Implement the two option cards: "Feed by topic" and "Feed by stars"
- Each card is a `<button>` (not a styled `<div>`) — keyboard accessible and correctly announced by screen readers
- Selecting a card reveals the appropriate subsequent step
- Playwright E2E test: clicking each card reveals the correct next step; cards are keyboard navigable

**3.4 — Featured topics checkbox grid (REQ-001)**

- Fetch `/api/topics/featured` on component mount
- Render as a grid of `<input type="checkbox">` elements with associated `<label>` elements
- Loading state: spinner within the grid container
- Error state: inline message with suggestion to try again
- Selection limit: disable unchecked checkboxes when 5 are selected (account for custom topics already added); announce limit reached via live region
- Playwright + axe-core test: grid is accessible; limit enforcement works; labels are associated

**3.5 — Custom topic input (REQ-008)**

- Implement the validate-and-add field
- Debounce API calls at 400–500ms
- Loading indicator within the field while the lookup is in progress
- Success state: "Add topic" button becomes active
- Error state: inline message `"No GitHub topic found matching '{value}'"` via `aria-describedby`
- Added topics render as removable tags with labelled remove buttons
- Duplicate detection: reject topics already in the selection with an inline message
- Playwright E2E test: debounce timing; valid topic enables button; invalid topic shows error; duplicate is rejected; tag removal works

**3.6 — GitHub username input (REQ-002 + REQ-009)**

- Implement the username input with the same debounced validation pattern
- On valid username: fetch `/api/starred/{username}` and render the starred repos list (REQ-009)
- Error states: username not found; user has no public starred repos (block progression, show message)
- Starred repos list: all selected by default; "Select all" / "Deselect all" controls; real-time filter by repo name; initial 25 results with "Load more" button; selection cap at 25 with inline message
- Playwright E2E test: empty username shows no error; invalid username shows error after debounce; valid username with stars shows list; "Load more" appends without losing selections; cap enforcement works

**3.7 — Activity type & TTL selectors (REQ-003 + REQ-004)**

- Implement activity type selector using native `<select>` or `<fieldset>` with `<input type="radio">` elements
- Implement TTL selector using native `<select>`
- Both are revealed only after the preceding step is complete
- Activity type filtering including "all activity" is confirmed feasible for topic feeds on the Workers Paid plan (OQ-4 resolved) — implement all options without restriction

**3.8 — Feed URL display & copy button (REQ-010)**

- On successful feed config submission, call `encodeFeedConfig` client-side and construct the feed URL
- Display the URL using the element type determined in the technical specification (likely `<a>`)
- Copy button uses `navigator.clipboard.writeText`; label changes to "Copied!" for 2 seconds on success; reverts automatically
- If Clipboard API is unavailable, the URL remains selectable
- Playwright E2E test: URL is generated correctly; copy button changes label on click; URL is accessible by keyboard

**3.9 — Error states & edge cases**

- GitHub API unavailable: user-facing message, no broken UI
- Feed generation failure: error message in place of URL, no dead end
- Malformed feed URL accessed directly: HTTP 400 page, human-readable, not a blank screen
- Playwright E2E tests for each error path using mocked Worker responses

**3.10 — Accessibility audit**

- Manual keyboard navigation test of the full topic flow and starred repo flow
- VoiceOver (macOS) test of both flows
- Resolve any issues before Phase 3 gate

### Phase 3 Gate

- Both full user flows complete end-to-end in Playwright
- axe-core reports zero critical or serious violations
- WCAG 2.1 AA manual audit passes (keyboard, VoiceOver)
- All responsive breakpoints from 320px upward are functional

---

## Phase 4 — P1 Features

**Goal:** Ship the remaining should-have features that complete the intended user experience.

### Tasks

**4.1 — Custom topic validation is already implemented in Phase 3.5 (REQ-008)**
This task is included here as a reminder to review it against the full acceptance criteria in the PRD before marking P1 complete.

**4.2 — Feed URL display semantic review (REQ-010)**
Review the URL display element choice against the decision documented in the technical specification. Confirm the implementation matches the documented rationale.

**4.3 — Sentry & Umami activation**

- Configure Sentry DSN for the production environment; confirm errors are captured and source maps resolve correctly in the Sentry dashboard
- Configure Umami for the production URL; confirm the five defined events are tracked correctly

### Phase 4 Gate

- All P1 acceptance criteria from the PRD are met and have corresponding passing tests
- Sentry captures a test error with a resolved stack trace
- Umami records a test event

---

## Phase 5 — Beta & Validation

**Goal:** Deploy to production and gather real usage data before investing in P2 features.

### Tasks

**5.1 — Production deployment**

- Confirm the Cloudflare account is on the **Workers Paid plan ($5/month)** — this is a hard requirement, not optional. The Workers Free plan's 50-subrequest limit per invocation is insufficient for topic feed fan-out (worst case 125 calls). The paid plan provides 10,000 subrequests per invocation.
- Deploy Worker via `wrangler deploy` against the production environment
- Confirm Cloudflare Pages production deployment is live
- Confirm Sentry and Umami are receiving production events
- Confirm the GitHub PAT is set as a Worker secret in the production environment

**5.2 — Smoke testing**

- Generate a topic feed URL manually and subscribe in NetNewsWire, Reeder, or Feedbin
- Confirm the feed validates at the W3C Feed Validation Service (manual check)
- Confirm entries appear correctly in the feed reader
- Generate a starred repo feed URL and repeat

**5.3 — Share for feedback**

- Share with a small set of trusted users (not a public announcement)
- Collect feedback on: topic cap (is 5 enough?), starred repo cap (is 25 enough?), activity type options, TTL options, feed content quality

**5.4 — Metrics baseline**

- Record baseline values for all success metrics defined in the PRD:
  - Unique feed URLs generated
  - Feeds still active after 7 days (early signal)
  - GitHub API rate limit headroom at peak
  - Feed generation p95 latency (Cloudflare Workers analytics)

### Phase 5 Gate

- At least one topic feed and one starred repo feed are live and polling correctly in a real feed reader
- No critical bugs are open
- Baseline metrics are recorded

---

## Phase 6 — Public Launch

**Goal:** Make OSSReleaseFeed publicly available and shareable.

### Tasks

**6.1 — Pre-launch checklist**

- All P0 and P1 acceptance criteria pass
- Zero critical axe-core violations
- Feed validates against W3C validator (manual)
- `robots.txt` in place (allow indexing)
- Open Graph meta tags in `index.html` for social sharing
- `<meta name="description">` is accurate and descriptive

**6.2 — Blog post**

- Write a post for schalkneethling.com covering: what the problem is, how OSSReleaseFeed solves it, how to use it, and what is planned next
- Include at least one shareable topic feed URL and one example starred repo feed URL as demonstrations

**6.3 — Announcement**

- Share the blog post and the tool URL on Mastodon and any relevant developer communities
- Monitor Umami for traffic spikes; monitor Sentry for error rate increases; monitor Cloudflare analytics for rate limit headroom

### Phase 6 Gate

- Tool is publicly accessible
- Blog post is published
- Announcement is made
- No critical errors in Sentry in the first 24 hours post-launch

---

## Phase 7 — Post-Launch: JSON Feed (REQ-013)

**Goal:** Add JSON Feed 1.1 as an output format. This is the first post-POC feature and should only begin after Phase 6 is complete and public launch metrics have been reviewed.

### Tasks

**7.1 — Confirm proceed decision**
Review Phase 5 and 6 metrics. If sustained user interest is not demonstrated (fewer than 40% of generated feeds still active at 30 days), reconsider the investment before building REQ-013.

**7.2 — JSON Feed serialisation**

- Add `format: "json"` to the `FeedConfig` type (already included in the data model)
- JSON Feed is produced by calling `feed.json1()` on the existing `Feed` instance returned by `buildFeed()` — no separate serialisation function is required; the `feed` package handles the full JSON Feed 1.1 spec
- Serve with `Content-Type: application/feed+json; charset=utf-8`
- All feed integrity requirements (stable IDs, content-aware `date_modified`, incremental updates) apply identically
- Validate output against [validator.jsonfeed.org](https://validator.jsonfeed.org) (manual check) and write an equivalent integration test

**7.3 — UI format selector**

- Add format selector to the builder UI before the URL is generated
- Default: Atom. Options: Atom, JSON Feed.

**7.4 — A/B test setup (optional)**
If usage data suggests the topic cap (5) or starred repo cap (25) should be evaluated, instrument an A/B test comparing 5 vs. 10 topics or 25 vs. 50 starred repos. Use Umami custom events to track which variant users receive and whether they hit the cap.

### Phase 7 Gate

- JSON Feed output passes integration test validation
- Builder UI offers format selection
- A/B test infrastructure is in place if decided upon

---

## Phase 8 — P2 Features

Only begin Phase 8 after Phase 7 is complete and post-POC metrics continue to show sustained interest.

- **REQ-011: QR Code** — client-side SVG QR code generation for the feed URL
- **REQ-012: Feed Preview** — first 5 entries rendered client-side using `DOMParser` against the generated feed URL

Each feature follows the same pattern: write acceptance criteria tests first, implement, verify CI passes, merge.

---

## Definition of Done (per task)

A task is done when:

- Implementation is complete and matches the relevant PRD acceptance criteria
- Tests are written and passing in CI (unit, integration, or E2E as appropriate)
- Linting passes with no warnings suppressed
- No accessibility regressions introduced (axe-core CI audit passes)
- The feature works at all viewport widths from 320px upward
- The feature is keyboard navigable and tested with VoiceOver

---

## Revision History

| Version | Date       | Author           | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-02-28 | Schalk Neethling | Initial draft                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1.1     | 2026-03-01 | Schalk Neethling | All OQs pre-resolved: Phase 0 tasks 0.2–0.5 marked RESOLVED; Phase 0 reduced to single spike validation task (0.6 — @octokit/rest dry-run). Phase 2.2 updated with @octokit/rest requirement, module-scope instantiation prohibition, and rate limit header approach. Phase 2.4 corrected to use `<link rel="alternate" href>` not tag URI `<id>` as diffing key. Phase 2 gate updated. Phase 3.7 conditional replaced with confirmed decision. Phase 5.1 Workers Paid plan requirement added. Phase 7.2 generateJSONFeed replaced with feed.json1() call. Informed-by version updated to Technical Specification v1.2. |
| 1.2     | 2026-03-01 | Schalk Neethling | Phase 0 removed as a separate phase. Resolved OQs moved to a Pre-Implementation preamble. Spike task moved to Phase 2.1 (post-scaffolding, inside real project). Phase 2 tasks renumbered 2.2–2.8.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1.3     | 2026-03-02 | Schalk Neethling | Adopted Effect (`effect` package). Task 2.1 spike extended to cover Effect bundle validation, `sValidator` integration, and per-request Layer pattern. Task 2.2 updated from Valibot to Effect Schema API. Task 2.3 updated to Effect service pattern (`Context.Tag`, typed errors, `Data.TaggedError`, per-request Layer construction). Task 2.4 updated to reference Effect schema. Phase 2 gate updated. Informed-by version updated to Technical Specification v1.3.                                                                                                                                                |
