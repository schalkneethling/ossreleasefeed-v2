# OSSReleaseFeed — Technical Specification

**Version:** 1.0  
**Date:** 2026-02-28  
**Author:** Schalk Neethling  
**Status:** Draft  
**Informed by:** PRD v1.1

---

## Purpose

This document defines the technical implementation decisions for OSSReleaseFeed. It covers architecture, tooling, data models, API design, feed generation, caching, testing strategy, CI/CD, and deployment. It is the authoritative reference for anyone building, reviewing, or extending the system.

This document is intentionally separated from the PRD. The PRD defines what is being built and why. This document defines how.

---

## Architecture Overview

```
Browser (React SPA, React Compiler enabled)
  ↓ HTTPS
Cloudflare Pages (static frontend hosting, preview deployments per PR)
  ↓
Cloudflare Worker (edge compute, single-file backend)
  ├── Route: / → serve React SPA
  ├── Route: /feed/{base64url-config} → generate and return Atom XML
  ├── Route: /api/topics/featured → proxy GitHub Topics API (featured list)
  ├── Route: /api/topics/validate?q={query} → proxy GitHub Topics API (existence check)
  └── Route: /api/users/validate/:username → proxy GitHub Users API (username existence + star count)
  └── Route: /api/starred/{username} → proxy GitHub Users API (starred repos)
        ↓
  Cloudflare Cache API (edge cache, keyed on full request URL)
        ↓
  GitHub REST API v3 + GitHub Atom feeds
  (all requests authenticated with server-side PAT stored as Worker secret)
```

No origin server. No database. No session state. The Worker is the entire backend. The Cloudflare Cache API is the only persistence layer.

---

## Tooling & Runtime

### Language

TypeScript throughout — frontend, Worker, and all test code. A single `tsconfig.json` at the root with project references for the `frontend/` and `worker/` packages. Strict mode enabled.

### Package Management & Script Running

**Local development:** Bun. Used as the package manager (`bun install`) and script runner (`bun run dev`, `bun run deploy`). Bun is not the production runtime — it is a DX tool only. The production runtime is always the Cloudflare Workers V8 isolate (`workerd`), which runs on V8; Bun runs on JavaScriptCore. There is no runtime swap happening.

**Bundling & deployment:** Wrangler handles all bundling via its internal esbuild pipeline and all deployment. Do not use `bun build` as a separate build step — Wrangler's bundler understands the `workerd` conditional exports in `package.json` that `bun build` would not resolve correctly. The correct local workflow is: `bun install` → `bun run dev` (invokes `wrangler dev`) → `bun run deploy` (invokes `wrangler deploy`).

**CI:** Node.js 22. Wrangler officially documents Node.js as its supported runtime and does not mention Bun in its install documentation. Bun works in practice due to its Node.js compatibility, but it is unsupported territory — a Wrangler update that broke under Bun would leave you on your own. Using Node.js in CI eliminates this risk entirely. The DX speed gains from Bun are felt during local development, which is where they matter most.

**Note on lockfiles:** Commit only the Bun lockfile (`bun.lock`). Do not maintain a `package-lock.json` alongside it — two lockfiles for the same dependency tree is a source of drift and confusion. CI uses Bun for dependency installation (`bun install --frozen-lockfile`) and the `wrangler-action` auto-detects the Bun lockfile, so this works cleanly. Wrangler's bundling and deployment behaviour is determined by its own internals, not by what package manager installed it — the Node.js runtime risk concern only applies to running Wrangler itself, which the CI workflow handles by invoking it via `npx wrangler` or the `wrangler-action` rather than through Bun's runtime.

### Frontend

- **Framework:** React 19+ with React Compiler enabled. The Compiler removes the need for manual `useMemo`, `useCallback`, and `memo` — do not add these manually; let the Compiler handle optimisation.
- **Scaffolding & build:** Vite. Configured to output a static build to `dist/` for Cloudflare Pages deployment.
- **Styling:** Standard CSS with custom properties for theming. No CSS framework. BEM naming convention for component class names. A single global `tokens.css` file defines all design tokens (colours, spacing, typography, radii, transitions) as custom properties.
- **No third-party component library.** All UI components are custom-built using native HTML elements, organised following a component architecture within `frontend/src/components/`.

### Worker

- **Runtime:** Cloudflare Workers (V8 isolate, not Node.js)
- **Worker router:** Hono — a minimal, TypeScript-first router built on web standard APIs and designed specifically for edge runtimes including Cloudflare Workers. It is not a framework in the traditional sense — it adds clean route definitions, typed context, and middleware support with no meaningful overhead and no tension with a web platform first approach. The native alternative is the URLPattern API (available in the Workers runtime without any import), which Hono itself builds upon internally. For a project with this route surface area, either is defensible; Hono is preferred here for the ergonomics it provides without the cost of writing routing and request/response boilerplate by hand. Reference: [Hono](https://hono.dev) · [MDN — URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern)
- **Feed serialisation:** The [`feed`](https://www.npmjs.com/package/feed) package (jpmonette/feed) for Atom 1.0 and JSON Feed 1.1 generation. Cloudflare Workers V8 isolate compatibility to be confirmed during the technical spike (OQ-2).
- **Effect:** The [`effect`](https://effect.website) package is used throughout the Worker for schema validation, typed error handling, service composition, and concurrent fan-out. It is a single dependency that replaces Valibot and removes the need for manual try/catch chains. See the Effect Architecture section and the Testing section for full details. The core Effect runtime is approximately 15kB compressed and tree-shaken — well within the 1MB Worker script size limit. The `effect` package ships as pure ESM with no Node.js-specific APIs, making it compatible with the Workers V8 isolate without the `nodejs_compat` flag. If bundle size ever becomes a concern after profiling, the [`Micro`](https://effect.website/docs/micro/new-users/) module offers a subset-compatible lighter alternative. Reference: [Effect docs](https://effect.website/docs) · [Why Effect?](https://effect.website/docs/getting-started/why-effect/)
- **GitHub API client:** `@octokit/rest` (or `@octokit/core` if a lighter client suffices). Workers compatibility is confirmed — Octokit explicitly targets browser, Node.js, and Deno environments using the standard `fetch` API and conditional `package.json` exports. The core dependencies (`@octokit/request`, `@octokit/graphql`, `universal-user-agent`, `before-after-hook`) are pure JavaScript with no Node.js-specific APIs.

  **Do not use the full `octokit` package.** It bundles `@octokit/plugin-throttling`, which calls `setTimeout` during module-level instantiation. The Cloudflare Workers runtime requires all async I/O (including timers) to occur within a `fetch` event handler scope — timers fired at the top level of a module are rejected with `Uncaught Error: Some functionality, such as asynchronous I/O, timeouts, and generating random values, can only be performed while handling a request.`

  **Instantiate inside the `fetch` handler, never at module scope:**

  ```ts
  // ✅ Correct — instantiate inside the handler
  export default {
    async fetch(request: Request, env: Env) {
      const octokit = new Octokit({ auth: env.GITHUB_PAT });
      // ...
    },
  };

  // ❌ Risky — module-scope instantiation triggers timers from throttling plugin
  const octokit = new Octokit({ auth: "..." });
  ```

  Rate-limit handling can be implemented directly from the `x-ratelimit-remaining` and `retry-after` response headers GitHub returns, without needing `@octokit/plugin-throttling`. Confirm clean bundle and deploy via `wrangler deploy --dry-run` during the Phase 0 spike.

### Testing

| Layer         | Tool                   | Scope                                                                                                     |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Unit          | Vitest                 | Pure functions: base64url encoding/decoding, FeedConfig validation, feed diffing, topic slug sanitisation |
| Integration   | Vitest                 | Feed generation pipeline with mocked GitHub API responses; Effect Schema assertions on mapped data        |
| End-to-end    | Playwright             | Full user flows: topic feed creation, starred repo feed creation, validation states, error states         |
| Accessibility | `@axe-core/playwright` | Run against Cloudflare Pages preview deployment on every pull request                                     |

**Validation strategy:** Use Effect's `Schema` module (from the `effect` package) for all data validation — `FeedConfig` decoding, GitHub API response parsing, and `FeedEntry` mapping. Effect Schema is the right choice for this project: it is fully tree-shakeable, implements the Standard Schema v1 spec (enabling direct integration with Hono's `@hono/standard-validator`), and is already present in the dependency tree for error handling and concurrency — there is no separate dependency to add.

Validate at every data boundary:

- **Incoming `FeedConfig`:** decode the base64url token and parse through the `FeedConfig` schema using `Schema.decodeUnknownEither`; invalid configs return HTTP 400 immediately
- **GitHub API responses:** parse each response through a typed schema before mapping to `FeedEntry`; a malformed or unexpected response shape surfaces as a typed `ParseError` caught in the Effect pipeline rather than silently producing bad feed output
- **`FeedEntry` before serialisation:** validate the mapped entry against the `FeedEntry` schema before passing to the `feed` library; this ensures `id` is a non-empty URL, `date` is a valid `Date`, and required fields are present

This replaces the need for a dedicated Atom XML validator in CI. Structural correctness of the Atom output is trusted to the `feed` library (which has its own snapshot tests per format). What your tests need to assert is that your data mapping produces valid, correctly-shaped input — Effect schemas make that precise and explicit.

**Mocking strategy:** Use MSW v2 (`msw/node`) for all integration tests that involve GitHub API calls. Since Octokit uses `fetch` internally, MSW intercepts at the network level without requiring any changes to production code. This keeps the Worker code straightforward while giving tests full control over GitHub API responses at the HTTP boundary, catching URL construction errors and missing headers that higher-level mocks would not.

MSW setup in Vitest (`tests/integration/setup.ts`):

```ts
import { beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` ensures any outgoing request without a matching handler throws immediately, catching accidental real network calls rather than letting them pass silently.

Handlers are defined per GitHub API endpoint in `tests/integration/handlers.ts` using `http.get` from `msw`. Individual tests can override default happy-path handlers using `server.use(...)` for error scenarios (rate limit 429, 404, network failure, malformed response).

Use Vitest's built-in `vi.fn()` for unit tests of pure functions where no network is involved.

### Linting & Formatting

All tooling configured at project initialisation and enforced in CI. Linting failures block merges.

| Tool      | Purpose                                                        | Config file         |
| --------- | -------------------------------------------------------------- | ------------------- |
| Oxlint    | ESLint-compatible linter (50–100x faster than ESLint)          | `.oxlintrc.json`    |
| Stylelint | CSS linting                                                    | `.stylelintrc.json` |
| Oxfmt     | Prettier-compatible formatter (beta, 30x faster than Prettier) | `.oxfmt.toml`       |

Both Oxlint and Oxfmt are part of the [Oxc project](https://oxc.rs) by VoidZero — a collection of high-performance JavaScript tooling written in Rust. Oxlint is production-ready with 650+ rules and true type-aware linting powered by `tsgo`. Oxfmt is currently in beta.

Oxlint rule sets to include: TypeScript rules, React rules, and `jsx-a11y` equivalent rules for catching accessibility violations at lint time. Confirm the available rule sets against the [Oxlint documentation](https://oxc.rs/docs/guide/usage/linter) during project initialisation — rule coverage differs from ESLint's plugin ecosystem and some rules may need to be sourced differently.

**Stylelint configuration** — `.stylelintrc.json`:

```json
{
  "extends": ["stylelint-config-standard"],
  "plugins": ["stylelint-plugin-logical-css", "stylelint-selector-bem-pattern", "stylelint-order"],
  "rules": {
    "media-feature-range-notation": "context",
    "order/properties-alphabetical-order": true,
    "logical-css/require-logical-keywords": true,
    "logical-css/require-logical-properties": true,
    "logical-css/require-logical-units": true,
    "plugin/selector-bem-pattern": {
      "preset": "bem"
    },
    "selector-class-pattern": "^(?!js-)[a-z][a-z0-9-]*(__[a-z][a-z0-9-]*)?(--[a-z][a-z0-9-]*)?$"
  }
}
```

Notes on the Stylelint configuration:

- `stylelint-config-standard` provides a sensible baseline covering modern CSS best practices
- `stylelint-plugin-logical-css` ([github.com/yuschick/stylelint-plugin-logical-css](https://github.com/yuschick/stylelint-plugin-logical-css)) enforces logical properties and values (e.g. `margin-inline-start` over `margin-left`) and logical units — essential for a project that takes internationalisation and writing direction seriously
- `media-feature-range-notation: "context"` enforces the modern range syntax for media queries (e.g. `@media (width >= 768px)`) over the legacy `min-width`/`max-width` form — reference: [MDN — Media feature range notation](https://stylelint.io/user-guide/rules/media-feature-range-notation/)
- `stylelint-selector-bem-pattern` enforces the BEM naming convention on all class selectors
- `selector-class-pattern` takes a single regex string that class names must match — there is no secondary options object. The pattern above enforces BEM structure while the negative lookahead `^(?!js-)` excludes `js-` prefixed names. It and `stylelint-selector-bem-pattern` are entirely independent rules with no shared configuration surface — both check the same selectors separately without conflict
- `order/properties-alphabetical-order` enforces alphabetical declaration ordering via `stylelint-order`, making property lookup predictable and diffs easier to read

---

## Repository Structure

```
ossreleasefeed/
├── frontend/              # React SPA (Vite)
│   ├── src/
│   │   ├── components/    # React components (one file per component)
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Pure utility functions (encoding, validation)
│   │   └── styles/        # CSS files (tokens.css + component stylesheets)
│   ├── index.html
│   └── vite.config.ts
├── worker/                # Cloudflare Worker (Hono)
│   ├── src/
│   │   ├── routes/        # One file per route group
│   │   ├── feed/          # Feed generation logic (feed package, diff logic)
│   │   ├── github/        # GitHub API client wrapper (Octokit)
│   │   └── lib/           # Shared utilities (base64url, schemas, encoding)
│   └── wrangler.toml
├── tests/
│   ├── unit/              # Vitest unit tests
│   ├── integration/       # Vitest integration tests (feed generation with mocks)
│   └── e2e/               # Playwright end-to-end + accessibility tests
├── .github/
│   └── workflows/         # GitHub Actions CI/CD workflows
├── .oxlintrc.json
├── .stylelintrc.json
├── .oxfmt.toml
└── package.json           # Root workspace (Bun workspaces)
```

---

## Data Model

The `FeedConfig` object is the single source of truth for a feed's configuration. It is JSON-serialised, base64url-encoded, and embedded in the feed URL path. No server-side storage is required.

All types are inferred from Effect schemas using `Schema.Schema.Type<typeof Schema>` — there are no hand-written TypeScript interfaces for validated data. The schema is the single source of truth for both runtime validation and static types.

Schemas live in `worker/src/lib/schemas.ts` and are shared across the Worker (validation) and frontend (encoding).

```ts
import { Schema } from "effect";

// --- Primitive schemas (reused across multiple schemas) ---

const GithubUsernameSchema = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/, {
    message: () => "Invalid GitHub username",
  }),
);

const TopicSlugSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9][a-z0-9-]*$/, { message: () => "Invalid GitHub topic slug" }),
  Schema.maxLength(35),
);

// --- FeedConfig schema ---

const FeedConfigSchema = Schema.Union(
  Schema.Struct({
    source: Schema.Literal("topics"),
    topics: Schema.Array(TopicSlugSchema).pipe(Schema.minItems(1), Schema.maxItems(5)),
    topicOperator: Schema.optionalWith(Schema.Literal("and", "or"), {
      default: () => "or" as const,
    }),
    activityType: Schema.Literal("releases", "all"),
    ttl: Schema.Int.pipe(Schema.greaterThanOrEqualTo(3600)),
    format: Schema.optionalWith(Schema.Literal("atom", "json"), { default: () => "atom" as const }),
  }),
  Schema.Struct({
    source: Schema.Literal("starred"),
    username: GithubUsernameSchema,
    repos: Schema.optionalWith(
      Schema.NullOr(Schema.Array(Schema.String).pipe(Schema.maxItems(25))),
      { default: () => null },
    ),
    activityType: Schema.Literal("releases", "all"),
    ttl: Schema.Int.pipe(Schema.greaterThanOrEqualTo(3600)),
    format: Schema.optionalWith(Schema.Literal("atom", "json"), { default: () => "atom" as const }),
  }),
);

// Inferred type — do not write this by hand
type FeedConfig = Schema.Schema.Type<typeof FeedConfigSchema>;

// --- FeedEntry schema ---

const FeedEntrySchema = Schema.Struct({
  id: Schema.String.pipe(Schema.nonEmptyString(), Schema.filter(isUrl)),
  title: Schema.NonEmptyString,
  link: Schema.String.pipe(Schema.filter(isUrl)),
  date: Schema.Date,
  summary: Schema.String,
  authorLogin: Schema.NonEmptyString,
  repo: Schema.NonEmptyString,
});

type FeedEntry = Schema.Schema.Type<typeof FeedEntrySchema>;
```

`Schema.Union` with a `source: Schema.Literal(...)` discriminant in each struct gives discriminated union behaviour — TypeScript narrows the type based on `source`, so `topics` and `username` are only present when they should be. `Schema.optionalWith(..., { default: () => value })` sets defaults at parse time, keeping callers free of null checks for optional fields with known defaults.

### Encoding & Validation

- The config object is serialised with `JSON.stringify` using a deterministic key order (keys sorted alphabetically) so that identical configs always produce identical URLs.
- The serialised JSON is encoded using the URL-safe base64 variant (`base64url`) — `+` → `-`, `/` → `_`, no padding `=`.
- On every Worker request, the encoded token is decoded and run through `Schema.decodeUnknownEither(FeedConfigSchema)`. Any validation failure returns HTTP 400 with a JSON error body: `{ "error": "Invalid feed configuration", "detail": "<parse error message>" }`. Using `decodeUnknownEither` rather than `decodeUnknownSync` avoids a thrown exception — the `Either.isLeft` branch handles the failure path explicitly.

---

## Input Validation & Sanitisation

All URL path parameters and query strings are validated with Effect Schema at the start of each Hono route handler, before any downstream use. This applies regardless of how the request was made — browser, curl, or any other client. No parameter reaches a GitHub API call or the cache key without first passing its schema.

Effect Schema implements Standard Schema v1, so validation at the route level uses Hono's `@hono/standard-validator` middleware — a single adapter that works with any Standard Schema-compatible library:

```ts
import { sValidator } from "@hono/standard-validator";
import { Schema, Either } from "effect";
import { GithubUsernameSchema, TopicSlugSchema } from "./lib/schemas";

// GET /api/users/validate/:username
app.get(
  "/api/users/validate/:username",
  sValidator("param", Schema.Struct({ username: GithubUsernameSchema })),
  (ctx) => {
    const { username } = ctx.req.valid("param"); // fully typed, guaranteed valid
    // ...
  },
);

// GET /api/topics/validate?q={query}
app.get(
  "/api/topics/validate",
  sValidator("query", Schema.Struct({ q: TopicSlugSchema })),
  (ctx) => {
    const { q: slug } = ctx.req.valid("query"); // fully typed, guaranteed valid
    // ...
  },
);
```

For cases where `sValidator` is not used (e.g. decoding `FeedConfig` from the URL path segment), use `Schema.decodeUnknownEither` directly — it returns `Either<ParseError, A>`, enabling explicit failure handling without try/catch:

```ts
const result = Schema.decodeUnknownEither(FeedConfigSchema)(decoded);

if (Either.isLeft(result)) {
  return ctx.json({ error: "Invalid feed configuration" }, 400);
}

const config = result.right; // narrowed, safe to use downstream
```

**What this prevents:** path traversal via crafted usernames, unexpected characters being forwarded into GitHub API URLs, and oversized or malformed inputs reaching any processing logic. The schemas enforce both shape and content constraints — a username with a path separator, an injected query parameter, or a topic slug containing uppercase characters all fail immediately at the handler boundary.

---

## Effect Architecture in the Worker

Effect is used throughout the Worker layer for typed error handling, service composition, and concurrent fan-out. The frontend does not use Effect — React component code remains plain TypeScript with standard async/await.

### Typed Errors

All expected failure cases in the Worker are modelled as tagged error types using `Data.TaggedError`. This encodes failure modes in the type signature of every function that can fail, making incomplete error handling a compile-time error rather than a runtime surprise:

```ts
import { Data } from "effect";

class GitHubRateLimitError extends Data.TaggedError("GitHubRateLimitError")<{
  retryAfter: number;
}> {}

class GitHubNotFoundError extends Data.TaggedError("GitHubNotFoundError")<{
  resource: string;
}> {}

class GitHubNetworkError extends Data.TaggedError("GitHubNetworkError")<{
  cause: unknown;
}> {}

class FeedParseError extends Data.TaggedError("FeedParseError")<{
  url: string;
  cause: unknown;
}> {}
```

A function that calls the GitHub API has a signature like `Effect<Release[], GitHubRateLimitError | GitHubNotFoundError | GitHubNetworkError, never>` — all failure cases are visible and must be handled by the caller, or explicitly re-raised.

### Service Layer

The GitHub API client is modelled as an Effect service using `Context.Tag`. This enables type-safe dependency injection without framework magic:

```ts
import { Context, Effect } from "effect";

interface GitHubClientService {
  getFeaturedTopics: () => Effect.Effect<Topic[], GitHubNetworkError>;
  validateTopic: (slug: string) => Effect.Effect<boolean, GitHubNetworkError>;
  getStarredRepos: (
    username: string,
  ) => Effect.Effect<Repo[], GitHubRateLimitError | GitHubNetworkError>;
  getRepoReleases: (
    owner: string,
    repo: string,
  ) => Effect.Effect<Release[], GitHubRateLimitError | GitHubNetworkError>;
  // ...
}

class GitHubClient extends Context.Tag("GitHubClient")<GitHubClient, GitHubClientService>() {}
```

### Workers-Specific: Per-Request Layer Construction

Effect's `Layer` system typically builds service graphs once at application startup and reuses them across requests. **This pattern does not work with Cloudflare Workers** — the `env` object containing PAT secrets and KV bindings is only accessible inside the `fetch` handler, not at module scope.

The required pattern is to construct the `Layer` inside the `fetch` handler, per request, and pass it to `Effect.runPromise` via `Effect.provide`. The overhead is negligible — Layer construction is synchronous object creation, not I/O:

```ts
import { Effect, Layer } from 'effect';
import { Octokit } from '@octokit/rest';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // ✅ Construct the Layer inside the fetch handler — env bindings available here
    const GitHubClientLive = Layer.succeed(
      GitHubClient,
      makeGitHubClient(new Octokit({ auth: env.GITHUB_PAT }))
    );

    return Effect.runPromise(
      handleRequest(request, env).pipe(
        Effect.provide(GitHubClientLive)
      )
    );
  },
};

// ❌ Do not construct Layers or access env at module scope
const GitHubClientLive = Layer.succeed(GitHubClient, makeGitHubClient(...)); // env not available here
```

This is the single most important Effect-specific constraint in a Workers environment. Violating it either fails silently (env bindings are undefined) or throws at module evaluation time.

### Concurrent Fan-Out

The topic feed pipeline makes up to 125 parallel GitHub API calls (5 topics × 25 repos). `Effect.all` with a controlled concurrency bound replaces `Promise.all`:

```ts
import { Effect } from "effect";

// Fetch releases for all repos concurrently, bounded to 20 parallel requests
const allReleases =
  yield *
  Effect.all(
    repos.map((repo) => fetchRepoReleases(repo.owner, repo.name)),
    { concurrency: 20 },
  );
```

This provides automatic error accumulation, structured cancellation, and a composable interface that `Promise.all` does not. The concurrency bound prevents Workers from hitting OS-level connection limits under peak fan-out.

### Retry with Schedule

Rate-limit retries use Effect's `Schedule` module rather than manual `retry-after` header inspection. This composably describes back-off policy:

```ts
import { Effect, Schedule, Duration } from "effect";

const retryPolicy = Schedule.exponential(Duration.seconds(1)).pipe(
  Schedule.jittered,
  Schedule.whileInput((e: unknown) => e instanceof GitHubRateLimitError),
  Schedule.upTo(Duration.seconds(30)),
);

const result = yield * fetchRepoReleases(owner, repo).pipe(Effect.retry(retryPolicy));
```

### Running Effects at the Hono Boundary

Hono handlers are async functions. Effect computations are run to completion with `Effect.runPromise` at the handler boundary. Errors that escape the Effect pipeline surface as unhandled promise rejections — ensure all expected error types are handled before `runPromise`:

```ts
app.get("/feed/:config", async (ctx) => {
  const result = await Effect.runPromise(
    generateFeed(config).pipe(
      Effect.provide(GitHubClientLive),
      Effect.catchAll((error) => Effect.succeed(errorResponse(error))),
    ),
  );

  return result;
});
```

References: [Effect docs](https://effect.website/docs) · [Effect — Running Effects](https://effect.website/docs/getting-started/running-effects/) · [Effect — Managing Layers](https://effect.website/docs/requirements-management/layers/)

---

## API Endpoints

### `GET /feed/{base64url-config}`

The core feed generation endpoint. Returns Atom 1.0 XML (or JSON Feed 1.1 if `format: "json"` is encoded in the config, once REQ-013 is implemented).

**Response headers:**

```
Content-Type: application/atom+xml; charset=utf-8
Cache-Control: public, max-age={ttl}
```

**Error responses:**

- `400 Bad Request` — malformed or invalid config token
- `503 Service Unavailable` — GitHub API unreachable; returns previous cached feed with `Retry-After` header if available, otherwise returns 503 with a human-readable error body

**Caching:** Responses are stored in the Cloudflare Cache API keyed on the full request URL. Cache TTL is the `ttl` value from the decoded config, subject to a server-enforced minimum of 3600 seconds.

### `GET /api/topics/featured`

Returns the top 25 featured GitHub topics for the checkbox list. Proxied from `https://api.github.com/search/topics?q=is:featured&per_page=25`.

**Response:** JSON array of topic objects `{ name: string, display_name: string, short_description: string }`.

**Caching:** Cached for 24 hours. Featured topics change infrequently.

### `GET /api/topics/validate?q={query}`

Validates whether a topic exists on GitHub. Proxied from `https://api.github.com/search/topics?q={query}&per_page=1`. Performs an exact name match on the response — a fuzzy match is not sufficient.

**Response:** `{ exists: boolean, name: string | null }`.

**Rate limit consideration:** This endpoint is called on every debounced keystroke from the custom topic input. Responses should be cached for a short TTL (e.g. 1 hour) to avoid burning rate limit budget on repeated lookups of the same topic.

### `GET /api/users/validate/:username`

Validates whether a GitHub username exists and has a public profile. Proxied from `https://api.github.com/users/{username}`.

**Response:** `{ exists: boolean, username: string | null, hasStars: boolean }`. The `hasStars` field indicates whether the user has any public starred repositories, allowing the frontend to block feed generation and surface a message before ever fetching the full starred repo list.

**Error responses:**

- Returns `{ exists: false, username: null, hasStars: false }` for unknown usernames — never a 404, so the frontend does not need to handle an error response for the not-found case.

**Rate limit consideration:** Responses should be cached for a short TTL (e.g. 5 minutes). Cache key is the full request URL.

### `GET /api/starred/{username}`

Returns the public starred repositories for a GitHub username. Proxied from `https://api.github.com/users/{username}/starred`.

**Response:** JSON array of repository objects `{ full_name: string, owner: string, name: string, stargazers_count: number, description: string | null }`.

**Pagination:** GitHub returns starred repos in pages of 30. The Worker fetches all pages up to a maximum of the first 100 starred repos (to limit API calls), returning them as a flat array. The "load more" pattern in the UI operates client-side against this pre-fetched list.

**Error responses:**

- `404 Not Found` — username does not exist or has no public profile
- Returns an empty array (not an error) if the user has zero public starred repos; the frontend is responsible for blocking feed generation in this case and displaying an appropriate message.

---

## Feed Generation

### Feed Library

Use the [`feed`](https://www.npmjs.com/package/feed) package (jpmonette/feed) for all feed serialisation. It supports Atom 1.0, RSS 2.0, and JSON Feed 1.1 from a single unified API, is TypeScript-first, actively maintained, and has only one dependency. This eliminates the need for a hand-rolled Atom XML renderer and makes JSON Feed (REQ-013) a near-zero-effort addition — the same `Feed` object, a different output method call.

Workers V8 isolate compatibility is confirmed (see OQ-2). The `nodejs_compat` flag is not required. No additional Wrangler configuration is needed beyond the defaults.

Example usage:

```ts
import { Feed } from "feed";

const feed = new Feed({
  title: "OSSReleaseFeed: accessibility, web-components",
  id: feedUrl,
  link: feedUrl,
  updated: mostRecentEntryDate,
  copyright: "",
});

entries.forEach((entry) => {
  feed.addItem({
    title: entry.title, // e.g. "[whatwg/html] Release: 2024-01-15"
    id: entry.githubUrl, // stable, permanent URI
    link: entry.githubUrl,
    date: entry.date,
    description: entry.summary,
    author: [{ name: entry.authorLogin }],
  });
});

// Atom 1.0
const atomXml = feed.atom1();

// JSON Feed 1.1 (REQ-013 — same object, different call)
const jsonFeed = feed.json1();
```

### Data Retrieval Strategy

The two feed source types use different retrieval approaches, determined by what GitHub exposes (see OQ-2).

**Topic-based feeds** — fan-out aggregation pipeline. GitHub exposes no native Atom feed per topic. The Worker must:

1. Query the GitHub Topics API to discover repositories tagged with the configured topic(s)
2. For each discovered repository, fetch release data via `/:owner/:repo/releases.atom` or the Releases REST API
3. Merge, sort, and deduplicate entries across all repositories before serialising

**Starred repository feeds** — per-repo Atom feeds. The Worker must:

1. Fetch the user's starred repositories via `GET /users/{username}/starred` (paginated, up to 100 repos)
2. For each starred repository, fetch `/:owner/:repo/releases.atom` directly
3. Merge, sort, and deduplicate entries before serialising

Using the per-repo `releases.atom` feed for the starred path is more efficient than the Releases REST API — it avoids paginating through REST responses and reduces overall rate limit consumption. The Atom feed returns the 10 most recent releases per repo, which is sufficient for a changelog-style feed.

### `<author>` Resolution

The `<author><name>` element is confirmed present in `releases.atom`, containing the GitHub username of whoever created the release. In automated release pipelines this will be a bot account (e.g. `lit-robot`) — that is correct and expected behaviour, not a bug. Map it directly to the `author` field in the `FeedEntry` schema.

Field mapping from `releases.atom`:

- Author login: `entry > author > name` → `FeedEntry.authorLogin`
- Entry link (use as stable `id`): `entry > link[rel="alternate"][@href]` → `FeedEntry.id` and `FeedEntry.link`
- Content (HTML-entity-encoded in the raw XML): `entry > content` — entities are decoded automatically by the XML parser during Atom feed parsing; **sanitise the decoded HTML** via `HTMLRewriter` before storing in `FeedEntry.summary`
- Date: `entry > updated` → `FeedEntry.date`
- Title: `entry > title` → used to construct the `[owner/repo] Release: {title}` entry title

**Important — entry `<id>` vs entry `<link>`:** GitHub's Atom `<id>` uses a tag URI scheme (`tag:github.com,2008:Repository/{repoId}/{tagName}`), not a plain URL. Do not use this as `FeedEntry.id`. Use the `<link rel="alternate" href>` value instead — it is the stable, human-readable GitHub release URL and the correct permanent identifier for feed diffing.

**`<media:thumbnail>`** — each entry includes a `<media:thumbnail url>` with the author's GitHub avatar URL. Not required by the `FeedEntry` schema but available if avatar display is added in a future iteration.

For issues & PRs (activity type "all"): author is `issue.user.login` from the Issues REST API — a stable, well-documented field in GitHub API v3.

### Incremental Updates (Feed Diffing)

The `feed` library handles serialisation only — feed diffing remains custom logic. On a cache miss, the Worker must not blindly regenerate the feed from scratch. The correct process is:

1. Fetch the previously cached feed response (if one exists)
2. Parse the cached Atom XML and extract all entry `<link rel="alternate" href>` URL values into a Set — this URL is the stable diffing key (see reasoning below)
3. Fetch fresh data from GitHub
4. Filter the fresh entries to those whose link URL is not in the cached Set
5. If no new entries exist: return the cached feed unchanged — same bytes, same `<updated>`, same everything. The feed reader polling this URL must not interpret the response as containing new content.
6. If new entries exist: build a new `Feed` object with all entries (new + existing), set `updated` to the most recent entry date, serialise and cache the result.

**Why `<link href>`, not `<id>`.** Every entry in GitHub's Atom feed carries two identifiers:

```xml
<entry>
  <id>tag:github.com,2008:Repository/95797174/@lit-labs/vue-utils@0.1.3</id>
  <link rel="alternate" type="text/html" href="https://github.com/lit/lit/releases/tag/%40lit-labs%2Fvue-utils%400.1.3"/>
</entry>
```

The `<id>` is a tag URI (RFC 4151) — a valid unique identifier but not a fetchable URL. It encodes GitHub's internal numeric repository ID and the release tag name. Critically, **GitHub never returns this tag URI via the REST API** — it only appears in Atom feed responses.

The `<link rel="alternate" href>` is the human-readable GitHub release URL, which can be constructed from `owner`, `repo`, and `tag` — data available from both the Atom feed and the REST API.

The diffing logic must match identifiers extracted from the **cached Atom feed** against identifiers on **freshly fetched `FeedEntry` objects**. Those fresh entries are built from the GitHub REST API, which does not return the tag URI. If the cached feed's `<id>` values were used as the Set keys, they would never match anything in the fresh batch — every entry would appear new on every request, defeating the entire purpose of diffing. The link URL is the only identifier that is consistent across both paths.

This diffing logic must be unit tested with Vitest using fixed input fixtures.

### HTML Sanitisation

Feed content from `releases.atom` is HTML-entity-encoded within the XML (e.g. `&lt;h3&gt;` rather than `<h3>`). The processing pipeline must **decode HTML entities first, then sanitise the resulting HTML** — sanitising the raw entity-encoded string will not strip unsafe tags because they are not recognised as tags until decoded.

**Confirmed approach (resolved via OQ-5):** Use Cloudflare's built-in **`HTMLRewriter`** for sanitisation — it is native to every Worker, requires no additional dependency, and is not subject to any script size budget concerns. The HTML Sanitizer API and DOMPurify are both unavailable in the Workers V8 isolate (no DOM).

**No separate entity-decoding dependency required.** Entity decoding is handled by the XML parser as a fundamental part of parsing the Atom feed. By the time the `<content>` field value is extracted from the feed XML, the parser has already decoded `&lt;script&gt;` → `<script>` etc. The decoded HTML string is passed directly to `HTMLRewriter` — no additional step or library needed. Specifically, `sax` (already present in the dependency tree via the `feed` package) handles this automatically during Atom feed parsing.

**Processing pipeline:**

1. **Parse Atom XML with `sax`** — entity decoding happens here, for free, as part of XML parsing. The extracted `<content>` value is already real HTML.
2. **Sanitise decoded HTML** — wrap in a `Response`, pipe through `HTMLRewriter`. Use element handlers to `.remove()` unsafe tags (`script`, `iframe`, `object`, `embed`, `form`) and strip event handler attributes (`on*`) from all elements.
3. **Read sanitised output** — call `.text()` on the transformed response before passing the result to `FeedEntry.summary` and the `feed` library.

```ts
async function sanitiseHtml(decodedHtml: string): Promise<string> {
  const unsafeTags = ["script", "iframe", "object", "embed", "form"];

  const response = new HTMLRewriter()
    .on(unsafeTags.join(","), { element: (el) => el.remove() })
    .on("*", {
      element(el) {
        for (const [name] of el.attributes) {
          if (name.startsWith("on")) el.removeAttribute(name);
        }
      },
    })
    .transform(new Response(decodedHtml));

  return response.text();
}
```

References: [Cloudflare Workers — HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)

---

## Caching Strategy

| Cache target        | Key                              | TTL                          | Notes                                         |
| ------------------- | -------------------------------- | ---------------------------- | --------------------------------------------- |
| Feed responses      | Full request URL                 | Config `ttl` value (min 1hr) | Per unique feed config                        |
| Featured topics     | `/api/topics/featured`           | 24 hours                     | Changes infrequently                          |
| Topic validation    | `/api/topics/validate?q={query}` | 1 hour                       | Short TTL, high reuse                         |
| Username validation | `/api/users/validate/{username}` | 5 minutes                    | Short TTL — user may gain stars or be created |
| Starred repos list  | `/api/starred/{username}`        | 1 hour                       | Balance freshness vs. API cost                |

All caching uses the Cloudflare Cache API. The Worker never sets cookies or uses KV storage.

**Rate limit handling (429):** If GitHub returns a 429, the Worker must:

1. Return the previously cached feed response unchanged
2. Add a `Retry-After` HTTP response header to indicate when the next attempt should be made
3. Never return an empty feed — doing so causes feed readers to treat all previously seen entries as removed

---

## Security

- The GitHub PAT is stored exclusively as a Cloudflare Worker secret (set via `wrangler secret put`). It is never committed to the repository, never included in build output, and never returned to clients.
- Feed config URLs encode no sensitive information. There is nothing to protect in the URL.
- No user data is stored anywhere. There is no database, no session state, and no tracking cookies. Umami Cloud is used for analytics — it is cookieless and collects no PII.
- `Content-Security-Policy` header served with all HTML responses. Policy to be defined during implementation — start restrictive and relax as needed.
- `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` headers on all responses.
- HTTPS only. HTTP requests are redirected to HTTPS.
- All API proxy endpoints (`/api/*`) are read-only. No write operations are exposed.

### Cloudflare Edge Protection

Cloudflare provides two layers of protection at the edge that require no application code — only deployment-time configuration in the Cloudflare dashboard.

**DDoS protection** is free, unmetered, and enabled automatically for all Cloudflare customers with no configuration required. Cloudflare's systems detect and mitigate volumetric and application-layer attacks in real time.

**Rate limiting rules** are included for Free, Pro, and Business plans without extra charges. Configure these in the Cloudflare dashboard under WAF → Rate Limiting Rules. A sensible starting point for this project is a rule scoped to `/api/*` limiting requests from a single IP to something like 30 requests per 10 seconds — enough headroom for legitimate use, low enough to blunt automated abuse. Both rules run at the edge before the Worker is invoked, meaning blocked requests do not count as Worker invocations and are not billed.

**Important:** the WAF and rate limiting rules only apply when the Worker is served from a custom domain. The default `workers.dev` URL bypasses the WAF entirely. Ensure production traffic uses a custom domain and that the `workers.dev` route is disabled.

---

## CI/CD — GitHub Actions

All workflows live in `.github/workflows/`. Every pull request and every merge to `main` must pass the full suite before proceeding.

### Workflows

**Critical path:** merges to `main` are where everything must run and pass — the full suite is non-negotiable there. Pull request workflows should be kept as fast as reasonable to preserve a short feedback loop. If PR runs become slow as the test suite grows, revisit which steps run on pull requests and consider deferring slower checks (e.g. end-to-end, accessibility audit) to the `main` merge workflow only.

**`ci.yml` — runs on every pull request and push to `main`**

```
1. Setup Node.js 22
2. Setup Bun
3. bun install --frozen-lockfile
4. Lint (Oxlint, Stylelint, Oxfmt check)
5. Type check (tsc --noEmit)
6. Unit tests (Vitest)
7. Integration tests (Vitest, with mocked GitHub API)
8. Build frontend: `bun run build --filter frontend` (Vite build only — must not touch Worker code)
9. Build check Worker: `wrangler deploy --dry-run` (Wrangler bundles the Worker via its internal esbuild pipeline — do not use `bun build` for this)
```

**`e2e.yml` — runs on every pull request and push to `main` (after Cloudflare Pages preview deployment)**

```
1. Setup Node.js 22
2. Setup Bun
3. bun install --frozen-lockfile
4. Wait for Cloudflare Pages preview URL to be available
5. Run Playwright end-to-end tests against preview URL
6. Run axe-core accessibility audit via Playwright against preview URL
```

Note: if PR feedback loops become too slow, this workflow is the first candidate to move to `main`-only. End-to-end tests are the most time-consuming step and depend on an external deployment being available.

**`deploy.yml` — runs on merge to `main`**

```
1. Setup Node.js 22
2. Setup Bun
3. bun install --frozen-lockfile
4. Deploy Worker via wrangler deploy
5. Cloudflare Pages deploys frontend automatically on push to main
```

### GitHub-Native Security Tooling

| Tool                | Trigger                                 | Purpose                                                                                                      |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **CodeRabbit**      | Every PR (automatic)                    | AI code review — line-by-line comments on bugs, logic issues, and code quality; free for public repositories |
| **Dependabot**      | Weekly (npm) + on workflow file changes | Automated dependency update PRs                                                                              |
| **CodeQL**          | Every PR + push to `main`               | Static analysis for security vulnerabilities                                                                 |
| **Socket Security** | Every PR                                | Supply chain security — detects malicious or compromised packages                                            |

**CodeRabbit** installs as a GitHub App and runs automatically on every pull request without any CI workflow configuration. It leaves inline review comments and a PR summary, but does not block merges — it is advisory only and sits outside the critical path. This is intentional: AI review is a quality aid, not a gate. If the signal-to-noise ratio proves poor in practice, it can be tuned via a `.coderabbit.yaml` config file in the repository root or disabled without touching any workflow files.

Note: Cursor's Bugbot was also considered but ruled out — it costs $40/user/month, is tightly coupled to the Cursor IDE, and offers no free tier for open source projects. CodeRabbit is the better fit here.

Dependabot configuration (`.github/dependabot.yml`):

```yaml
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

---

## Deployment

### Frontend — Cloudflare Pages

The React SPA is deployed to Cloudflare Pages. Cloudflare Pages automatically creates a preview deployment for every pull request, giving the Playwright + axe-core E2E suite a stable URL to run against before merge.

Build settings:

- Build command: `bun run build --filter frontend` (Vite build only — scoped to the `frontend` workspace to ensure Worker code is never touched here; Wrangler handles the Worker separately)
- Build output directory: `frontend/dist`
- Environment variable: `VITE_WORKER_URL` pointing to the deployed Worker URL

### Worker — Cloudflare Workers

**Plan requirement: Workers Paid ($5/month) is mandatory.** The Workers Free plan is capped at 50 external subrequests per invocation. The worst-case fan-out for topic feeds (5 topics × 25 repos = 125 GitHub API calls) exceeds this limit and will fail outright on Free. Workers Paid provides 10,000 subrequests per invocation — 125 calls is well within budget.

The Worker is deployed via Wrangler. The Worker handles all API routes and feed generation. The `wrangler.toml` defines route bindings.

Secrets (set once via `wrangler secret put`, never committed):

- `GITHUB_PAT` — personal access token for GitHub API requests

---

## Monitoring & Analytics

### Error Monitoring — Sentry

Sentry is integrated in both the React frontend and the Cloudflare Worker. Configure source map uploads in the CI build step so stack traces in Sentry map to original TypeScript source.

- Frontend: `@sentry/react`
- Worker: `@sentry/cloudflare`

No personally identifiable information should be sent to Sentry. Scrub any user-provided data (usernames, topic names) from error context before sending if it appears in stack frames.

### Analytics — Umami Cloud

Umami Cloud is used for privacy-respecting, cookieless usage analytics. No PII is collected, no cookies are set, and data is not shared with third parties. Integration is a single script tag in `frontend/index.html` — no npm package required.

Events to track:

- Feed builder started (button clicked)
- Feed type selected (topic / starred)
- Feed URL generated successfully
- Feed generation failed (with error type, no user data)
- Copy button clicked

The `data-website-id` attribute value is stored as a Vite environment variable (`VITE_UMAMI_WEBSITE_ID`) and injected at build time. Do not hardcode it in the repository.

---

## Open Questions (from PRD — to resolve during technical spike)

These must be answered before the corresponding implementation work begins. Update this document with findings.

**OQ-1: Bun + Cloudflare Workers build compatibility — RESOLVED**
Bun works well as a package manager and script runner for Cloudflare Workers projects. The correct hybrid approach is: Bun locally (`bun install`, `bun run dev`, `bun run deploy`), Wrangler for all bundling and deployment, Node.js 22 in CI. Do not use `bun build` as a pre-bundling step — Wrangler's internal esbuild pipeline handles this correctly and understands `workerd` conditional exports that `bun build` would not resolve the same way. Wrangler officially documents Node.js as its supported runtime; Bun works in practice but is unsupported — Node.js in CI eliminates any pipeline risk. See the Package Management & Script Running section for full detail.

**OQ-2: GitHub topic Atom feeds + `feed` package Workers compatibility — RESOLVED**

**GitHub topic Atom feeds — do not exist.** Navigating to `github.com/topics/web-components.atom` redirects to the generic Topics landing page. GitHub exposes no native Atom feed for topic pages. The fan-out aggregation pipeline from the PRD is the correct and only architecture for topic-based feeds — there is no upstream feed to proxy.

GitHub does expose per-repository Atom feeds, confirmed working: `/:owner/:repo/releases.atom`, `/:owner/:repo/commits.atom`, `/:owner/:repo/tags.atom`, and `/:user.atom` for user activity. These are useful for the starred repositories path — rather than paginating through the Releases REST API for each repo, the Worker can fetch the user's starred repos via the API and then consume each repo's `releases.atom` directly. This avoids unnecessary REST API pagination and reduces rate limit consumption on the starred path.

**Architecture implications:**

- **Topic feeds:** use the GitHub Topics API to discover repos by topic, then fan out to each repo's `releases.atom` or the Releases REST API for release data. No shortcut available.
- **Starred feeds:** fetch starred repos via `GET /users/{username}/starred`, then consume each repo's `releases.atom`. More efficient than the REST API for release data retrieval.

**`feed` npm package — confirmed compatible with Cloudflare Workers V8 isolate.** The package has one runtime dependency (`xml-js`) which depends on `sax` — a pure JavaScript XML parser explicitly designed for both Node.js and browser environments. No Node.js-specific APIs (`fs`, `crypto`, `stream`, etc.) exist anywhere in the dependency chain. The entire stack is string manipulation and object construction. The `nodejs_compat` compatibility flag is not required. Wrangler's esbuild bundler resolves and inlines the package without any additional configuration.

Validate during initial Worker setup by running `wrangler deploy --dry-run --outdir dist` to confirm a clean bundle before committing to the package in implementation.

**OQ-3: `<author>` data availability from GitHub API — RESOLVED**

Both paths are confirmed. The `<author>` Resolution section in Feed Generation above has been updated with the full field mappings.

- **`releases.atom`:** `<author><n>` is present on every entry, confirmed via live inspection of `github.com/lit/lit/releases.atom`. Contains the GitHub login of whoever created the release — may be a bot account for automated pipelines, which is correct expected behaviour.
- **Issues REST API (`/repos/{owner}/{repo}/issues`):** `issue.user.login` is a stable, well-documented field in the GitHub Issues REST API v3. No spike required.

See the `<author>` Resolution section for the full field mapping including the HTML entity-decoding requirement and the `<media:thumbnail>` availability note.

**OQ-4: Activity type filtering feasibility for topic feeds — RESOLVED**

The original framing (measure latency and rate limit consumption) was the wrong question. The binding constraint is the Cloudflare Workers **subrequest limit**, not GitHub's rate limit.

- **Workers Free plan:** 50 external subrequests per invocation (hard limit). Worst-case 5 topics × 25 repos = 125 GitHub calls exceeds this and will fail outright — not degrade gracefully.
- **Workers Paid plan:** 10,000 subrequests per invocation (default). 125 calls is trivially within budget.
- **GitHub rate limit:** 5,000 authenticated requests/hour. At side-project scale, 125 calls per cache miss is not a concern.

**Decision:** Workers Paid plan ($5/month) is a hard deployment requirement, not optional. Document this in the Deployment section. Activity type filtering remains feasible on Paid — no need to restrict topic feeds to "releases only" on account of this constraint. Latency under fan-out (125 parallel `fetch()` calls) should still be validated during the spike, but is not expected to be a blocker given Workers' concurrent subrequest handling.

**OQ-5: HTML sanitisation in the Worker runtime — RESOLVED**

Neither the HTML Sanitizer API nor DOMPurify are available in the Cloudflare Workers V8 isolate — both require a DOM that does not exist in that environment. The correct approach uses **`HTMLRewriter`**, Cloudflare's own built-in streaming HTML parser, which is native to every Worker and requires no additional dependency.

Entity decoding is not a separate step requiring an additional library. The XML parser (`sax`, already in the dependency tree via the `feed` package) decodes HTML entities as a fundamental part of parsing the Atom feed XML. The `<content>` field value is already decoded real HTML by the time it is extracted. It can be passed directly to `HTMLRewriter` for sanitisation.

The sanitisation pipeline is therefore: `sax` parses Atom XML (entities decoded automatically) → `HTMLRewriter` strips unsafe tags and event handler attributes → sanitised HTML string stored in `FeedEntry.summary`. No additional npm dependency is required.

The HTML Sanitisation section above has been updated to reflect this pipeline.

---

## Revision History

| Version | Date       | Author           | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-02-28 | Schalk Neethling | Initial draft, derived from PRD v1.1 Technical Considerations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.1     | 2026-03-01 | Schalk Neethling | OQ-2 resolved: GitHub topic Atom feeds do not exist; fan-out pipeline confirmed; per-repo releases.atom viable for starred path; feed package Workers compatibility confirmed. Data Retrieval Strategy section added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.2     | 2026-03-01 | Schalk Neethling | OQ-3 resolved: author field confirmed in releases.atom and Issues API. OQ-4 resolved: Workers Free plan 50-subrequest hard limit makes Paid plan a deployment requirement; 125 fan-out calls feasible on Paid. OQ-5 resolved: HTMLRewriter (built-in) + html-entities (npm) confirmed as sanitisation pipeline; DOMPurify and HTML Sanitizer API unavailable in Workers V8 isolate. HTML Sanitisation section rewritten with confirmed implementation.                                                                                                                                                                                                                                                                                      |
| 1.3     | 2026-03-02 | Schalk Neethling | Adopted Effect (`effect` package) for the Worker layer. Replaces Valibot with Effect Schema; all schema code examples updated to Effect Schema API. Input Validation section updated to use `@hono/standard-validator` with Standard Schema v1 (implemented by Effect Schema) and `Schema.decodeUnknownEither` for non-route validation. New Effect Architecture section added covering typed errors (`Data.TaggedError`), service layer (`Context.Tag`/`Layer`), the Workers-specific per-request Layer construction constraint, concurrent fan-out with `Effect.all`, retry with `Schedule`, and running Effects at the Hono boundary. Testing strategy updated to reference Effect Schema. Effect bundle check added to Phase 2.1 spike. |
