# OSSReleaseFeed

A lightweight, zero-authentication tool for building personalised Atom feeds from GitHub open source activity.

Provide a GitHub username or a set of topics, configure your preferences, and get a single permanent feed URL you can drop into any feed reader. No account, no OAuth, no email — just a URL that works.

[Try the live app](https://ossreleasefeed.schalkneethling.com/) ·
[Watch the WebMCP demo](https://www.youtube.com/watch?v=pbrbGPcOooQ)

## What it does

- **Topic feeds** — follow all releases across repositories tagged with one or more GitHub topics
- **Starred repo feeds** — follow releases from everything you've starred on GitHub
- **Atom & JSON Feed** — output in whichever format your feed reader prefers

## WebMCP

In a WebMCP-capable browser, an agent can build a topic feed through tools
exposed directly by the page. Every agent action remains visible in the feed
builder, so the user can follow along, refine the configuration manually, or
take over completely.

To try it, open the live app in the ChatGPT in-app browser or another
WebMCP-capable browser and ask: “Using this page's site tools, build an Atom
feed for the GitHub topics CSS and TypeScript. Include all activity and update
it every 24 hours. Keep every change visible in the page and stop after
generating the feed URL.”

The manual and WebMCP paths share the same feed configuration, state reducer,
GitHub validation API, and feed URL generator. Manual controls constrain many
inputs in the interface, while WebMCP validates structured tool input through
schemas and runtime checks before using the shared GitHub topic validation.

The application follows a strict newer-action-wins policy. A newer WebMCP
mutation aborts older pending WebMCP work, and a manual change to the current
feed configuration immediately revokes pending mutating WebMCP work before the
user's change is applied. Revision checks prevent a late response from
overwriting the user's latest choices or a feed URL they have already
generated.

The human and agent journeys used for manual and automated testing are
documented in [scenarios](scenarios/README.md).

## Status

In public beta. Things may still change, and you may hit rough edges — please
[report an issue](https://github.com/schalkneethling/ossreleasefeed-v2/issues)
if you do (there's also a link in the app's footer).

## Tech

- **Frontend:** React 19, Vite, standard CSS — hosted on Cloudflare Pages
- **Backend:** Cloudflare Worker, Hono, Effect, TypeScript
- **Agent interface:** WebMCP tools over the feed configuration shown in the
  current browser tab

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams of the request
flow, the GitHub subrequest budget, and the feed builder UI states.

The adaptive feed experiment's current status and remaining phased work are in
[docs/ADAPTIVE-FEED-ROADMAP.md](docs/ADAPTIVE-FEED-ROADMAP.md).

## Local development

### Prerequisites

- Node.js 22
- Corepack with pnpm 11.9.0
- The 1Password desktop app and CLI, with desktop-app integration enabled
- Access to the project's Cloudflare account for remote Workers AI and
  Flagship bindings

Install the repository dependencies and Playwright's Chromium browser:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

The Worker resolves `GITHUB_PAT` through Varlock and 1Password. The expected
item is `ossreleasefeed-github-pat` in the `dev` vault, with the token stored in
its `credential` field. A fine-grained GitHub token with public-repository read
access is sufficient. Verify the secret without printing its value:

```sh
pnpm exec varlock load
```

Start the Worker and frontend in separate terminals:

```sh
pnpm run dev:worker
```

```sh
pnpm run dev:frontend
```

Vite proxies `/api` and `/feed` requests to the Worker on port 8787. The
adaptive homepage is available only when the Cloudflare Flagship flag
`adaptive-feed-builder` evaluates to `true` for the `local` surface. Guided
mode remains available when the flag is disabled.

When the browser exposes `document.modelContext`, the page also registers a
progressive WebMCP toolset for building topic feeds. The tools update the
visible Guided/Ask feed configuration through the existing reducer, validate
topics through the existing API, and generate URLs with the canonical encoder.
They do not call the assistant endpoint. A newer WebMCP mutation or a manual
change to the current feed configuration cancels pending WebMCP validation; a
revision guard ensures a late response cannot overwrite the user's newer state.
Browsers without WebMCP support continue to use the app normally.

For local WebMCP development in Chrome, enable
`chrome://flags/#enable-webmcp-testing` and relaunch the browser. Deployed
origins can enroll in Chrome's WebMCP origin trial starting with Chrome 149;
the API is not yet generally shipped. See the
[Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp) and
[Chrome Status](https://chromestatus.com/feature/5117755740913664).

Run the standard local checks with:

```sh
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

Account setup, Cloudflare resources, deployment secrets, and optional service
configuration are tracked in [TODO.md](TODO.md). Secret values are never
committed.

## Contributing

Beta is out, but there's no formal contribution process yet — code PRs
aren't being accepted for now. Bug reports and feedback via
[issues](https://github.com/schalkneethling/ossreleasefeed-v2/issues) are
very welcome.

## License

[MIT License](LICENSE)
