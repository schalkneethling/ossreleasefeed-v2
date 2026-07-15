# Architecture

No origin server, no database, no session state. The Worker is the entire
backend; the Cloudflare Cache API is the only persistence layer.

## System overview

```mermaid
flowchart TD
    Browser["Browser (React 19 SPA)"]

    subgraph Pages["Cloudflare Pages"]
        SPA["Static frontend\n(preview deploy per PR)"]
    end

    subgraph Worker["Cloudflare Worker (Hono + Effect)"]
        Feed["GET /feed/:config"]
        Topics["GET /api/topics/*"]
        Users["GET /api/users/validate/:username"]
        Starred["GET /api/starred/:username"]
    end

    Cache[("Cloudflare Cache API\n(edge cache, keyed on request URL)")]
    GitHub[("GitHub REST API v3\n(server-side PAT, Worker secret)")]
    Sentry[("Sentry\n(error tracking)")]
    Umami[("Umami\n(analytics)")]

    Browser -- HTTPS --> SPA
    Browser -- "fetch (CORS-checked)" --> Worker
    Browser -. events .-> Umami

    Feed <--> Cache
    Feed --> GitHub
    Topics --> GitHub
    Users --> GitHub
    Starred --> GitHub

    Worker -. captured errors .-> Sentry
    SPA -. captured errors .-> Sentry
```

`/feed/*` is unauthenticated and CORS-free (it's consumed by feed readers, not
the browser's `fetch`). `/api/*` remains publicly accessible, but it is
CORS-enabled only for an origin allow-list (the production domains plus the
`*.ossreleasefeed.pages.dev` preview-deploy pattern) so only those browser
origins receive readable cross-origin responses — see `worker/src/index.ts`.

## Feed request flow

What happens on `GET /feed/:config`, including the cache/diff/fallback logic
in `worker/src/routes/feed.ts`:

```mermaid
sequenceDiagram
    participant R as Feed reader
    participant W as Worker (feed route)
    participant C as Cache API
    participant G as GitHub API

    R->>W: GET /feed/:config
    W->>W: decode + validate config
    alt config invalid
        W-->>R: 400
    end

    W->>C: match(request)
    alt cache hit
        C-->>W: cached response
        W-->>R: cached response
    else cache miss
        W->>C: match(snapshot request)
        C-->>W: previous snapshot (or none)

        W->>G: fetch releases + issues (fan-out, capped repo count)
        alt GitHub OK
            G-->>W: entries
            W->>W: diff against previous snapshot
            alt no new entries and a previous snapshot exists
                W->>W: reuse previous entries
                W->>C: put(request, response)
            else new or first-ever fetch
                W->>W: merge fresh + previous, cap at 250 entries
                W->>C: put(request, response)
                W->>C: put(snapshot request, atom snapshot)
            end
            W-->>R: 200 feed body
        else GitHub rate-limited and a previous snapshot exists
            G-->>W: rate limit error
            W-->>R: 200 stale feed + Retry-After
        else any other error (incl. subrequest-cap exceeded)
            G-->>W: error
            W->>W: captureFeedError() → Sentry
            W-->>R: 503 { error: "GitHub temporarily unavailable" }
        end
    end
```

Two response caches are kept per config: the outward-facing one (in the
requested format/TTL) and a 7-day atom "snapshot" used purely to diff against
on the next fetch, independent of the caller's cache TTL.

## GitHub subrequest budget

`generateFeedEntries` (`worker/src/feed/generate.ts`) fans out release and
issue fetches per repo, concurrency-capped, and caps the repo count so the
total subrequest count stays under the Workers free plan's 50-subrequest
ceiling:

```mermaid
flowchart LR
    Config{"config.source"}
    Config -->|topics| Search["Search repos by topic(s)\n1 subrequest (and) or\nup to 5 (or, one per topic)"]
    Config -->|repos selection| Selected["Use selected repos directly\n0 search subrequests"]
    Config -->|starred| Starred["Fetch user's starred repos\n1 subrequest"]

    Search --> Cap["Cap repo count:\nreposLimitForAllActivity(searchSubrequests)"]
    Selected --> Cap
    Starred --> Cap

    Cap --> FanOut["Fan out per repo (concurrency 20)"]
    FanOut --> Releases["getRepoReleases × N"]
    FanOut -->|"activityType === all"| Issues["getRepoIssues × N"]
    Releases --> Merge["mergeEntries(releases, issues)"]
    Issues --> Merge
```

A single repo's failure (404, network error, parse error) resolves to an
empty entry list rather than aborting the whole feed — only a GitHub
rate-limit error propagates, since that's the one case `feed.ts` can recover
from with a stale-cache fallback.

## Feed builder UI flow

The frontend's guided flow, from landing to a generated feed URL
(`frontend/src/components/Builder.tsx` and its steps):

```mermaid
stateDiagram-v2
    [*] --> Hero
    Hero --> ModeSelection: Create a feed
    ModeSelection --> TopicStep: mode = topics
    ModeSelection --> StarredStep: mode = starred

    state TopicStep {
        [*] --> PickingTopics
        PickingTopics --> PickingTopics: toggle featured topic\n(max 5)
        PickingTopics --> ValidatingCustom: type custom topic
        ValidatingCustom --> PickingTopics: valid → added\ninvalid/duplicate/error → shown inline
        PickingTopics --> ConfiguringFeed: ≥1 topic selected
    }

    state StarredStep {
        [*] --> EnteringUsername
        EnteringUsername --> ValidatingUsername: debounced input
        ValidatingUsername --> EnteringUsername: not-found / no-stars / error
        ValidatingUsername --> RepoListLoaded: valid
        RepoListLoaded --> RepoListLoaded: select/deselect (max cap)\nfilter, load more
        RepoListLoaded --> ConfiguringFeed: ≥1 repo selected
    }

    ConfiguringFeed --> ConfiguringFeed: change activityType / ttl\n(clears any generated URL)
    ConfiguringFeed --> FeedGenerated: Generate feed URL
    FeedGenerated --> ConfiguringFeed: change config again
    FeedGenerated --> [*]
```

Both steps use the same `FeedConfigPanel` for the final activity-type/TTL
choice and URL generation; changing any upstream selection clears a
previously generated URL so it can't silently go stale in the UI.

## What's out of scope

No auth, no database, no server-rendered pages, no queues/durable objects.
The Worker is stateless per request beyond the two Cache API entries per
feed config.
