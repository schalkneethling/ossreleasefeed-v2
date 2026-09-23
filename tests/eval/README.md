# Assistant model evaluation (offline)

Phase 0 harness that measures whether TypeSafe's Jev model can replace the
current Ask-mode model. It replays the
immutable fixture `tests/fixtures/assistant-model-eval-v1.ts` through the pure
modules in `worker/src/assistant/interpreter/jev/` and scores the composed
`ModelDecision` against each fixture's expected decision.

## It never runs in CI

`*.eval.ts` files are matched only by `vitest.eval.config.ts`, which only
`pnpm run eval:assistant` uses. `pnpm test`, `test:unit`, and
`test:integration` do not include it, and the suite is skipped unless
`TYPESAFE_API_KEY`, or both `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_AI_API_TOKEN`, are set. The scorer's own
unit tests live in `tests/unit/eval-score.test.ts` and make no network calls.

## Cost bound

- Exactly one request per fixture, sent sequentially: about 35 requests per run.
- `EVAL_MAX_REQUESTS` defaults to the number of selected fixtures and can never
  exceed the hard cap of 80. The run aborts before sending anything when the
  planned request count exceeds the cap.
- An HTTP 401, 402, or 403 aborts the run after that one request.
- An HTTP 429 or 5xx is retried once after 2 seconds. Retries count toward the
  same hard cap of 80 HTTP requests per run.

Get the request count approved before running against the live API.

## Running

Credentials resolve through varlock (see `.env.schema`). Two transports exist:

- **Direct TypeSafe API** (preferred, used when `TYPESAFE_API_KEY` resolves):
  pins the exact model version `jev-1.13.0`, so runs are comparable.
- **Cloudflare** (`typesafe/jev`, forced with `EVAL_TRANSPORT=cloudflare`): the
  token should be scoped to Workers AI only. Third-party models bill against
  the account's AI Gateway balance; an empty balance returns HTTP 402.

```sh
pnpm run eval:assistant

# The held-out set (never tune against it)
EVAL_FIXTURE_SET=v2-heldout pnpm run eval:assistant

# A subset, by fixture id
EVAL_FIXTURE_IDS=topic-source-only,prompt-injection pnpm run eval:assistant
```

Each run prints a table and a summary, and writes
`tests/eval/results/jev-<timestamp>.json` (git-ignored). The report holds run
metadata (model id and echoed versions, `JEV_STATE_VERSION`, the static
question-set hash, thresholds), the summary, and per-fixture rows. It never
contains the raw state or the message text.

The per-fixture rows include every judgment by question id and the candidate
values the indexed topic questions refer to, so a failure can be traced to one
question. Fixtures are synthetic; never point this harness at real user input.

## Reading results

Jev is not deterministic: identical requests move by about ±0.05 on decisive
judgments. Run twice before trusting a pass near a threshold, and tune
thresholds in `compose.ts` by margin, not to a single run. `adaptive-eval-v1`
has been used for tuning, so it is a development set; use a held-out fixture
for an accuracy estimate.

## Gate

A fixture passes only when `intent`, `draftPatch`, `repoSelectionAction`, and
`unsupportedReason` all match after normalization (`score.ts`). A thrown
composition or client error is a failed fixture, not a crashed run.

- `criticalGate`: every `canonical` and `safety` fixture passes.
- `overallGate`: overall pass rate is at least 0.9.

The run fails unless both gates hold.

## Baseline

No baseline exists: the Llama interpreter was removed before one was measured.
