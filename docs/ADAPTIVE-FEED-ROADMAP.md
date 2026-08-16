# Adaptive feed experiment — handoff and roadmap

## Purpose

The experiment asks whether OSSReleaseFeed can let people choose how they work:
the familiar Guided builder, a conversational typed interface, or—later—voice.
The application should reveal trusted controls only when they are useful or
requested, and should skip directly to a validated feed URL when the user has
already supplied everything required.

Guided mode remains the production baseline throughout the experiment. The
runtime Cloudflare Flagship flag `adaptive-feed-builder` is the kill switch for
the adaptive homepage and every assistant turn.

## Current status

Phase 2 is complete on `main`.

The repository currently supports:

- A runtime-flagged **Guide me / Ask for a feed** entry point.
- Multi-turn typed topic-feed conversations backed by Workers AI.
- Deterministic application validation, state transitions, product copy, and
  feed URL generation. The model cannot generate markup or URLs.
- Conversational capability, topic, and settings questions without revealing
  controls automatically.
- An explicit “Show UI” intent that reveals registered React components for
  the validated conversation state.
- Mixed typed and point-and-click topic configuration.
- Controlled mode switching, Guided fallback, stale-URL clearing, Start over,
  and versioned seven-day local persistence.
- Client and network rate limits, exact `Retry-After` feedback, cancellation,
  and a Flagship kill switch.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the authoritative request flow,
state-machine behavior, trust boundaries, rate limits, and persistence rules.

## Invariants to preserve

- Guided mode must remain usable when the experiment is disabled or fails.
- The Worker evaluates the runtime flag again for every assistant turn and
  fails closed.
- One controlled feed draft is shared across Guided and Ask modes.
- The model proposes intent, state, and a draft patch only. Application code
  validates GitHub entities and product constraints and creates the URL.
- Informational questions remain textual until controls are requested or a
  control is needed to resolve ambiguity.
- “Show UI” composes only registered components and reflects the validated
  conversation state, including existing issues.
- Changing configuration clears a generated URL.
- An update interval is not considered selected merely because the draft
  contains the one-hour default.
- Prompts, transcripts, usernames, repositories, topics, URLs, and experiment
  identifiers must not enter logs or analytics.
- Each phase is a deployable vertical slice and stops for testing and review
  before the next phase begins.

## Phase 3 — Starred repositories and full parity

Add the second complete source to Ask mode without changing the established
topic experience.

### Vertical slice

- Interpret and validate public GitHub usernames.
- Generate directly with all starred repositories when the user explicitly
  requests all of them.
- Reveal the existing repository picker for subsets, ambiguous names, or an
  explicit request to review selections.
- Validate named subsets against the user's fetched public starred
  repositories.
- Preserve the 25-repository cap and the existing no-user, no-stars, and
  GitHub-error behavior.
- Support activity and update-frequency changes through either conversation or
  trusted controls.
- Preserve Guided parity: Atom output, current activity choices, and current
  update-frequency values.
- Keep follow-up responses proactive: confirm what was accepted, identify the
  next decision, and offer either textual options or the relevant UI.

### Phase 3 stop

- Run lint, typecheck, unit, integration, build, and the complete topic/starred
  end-to-end suite.
- Test all-star generation, subsets, ambiguous and invalid repositories,
  invalid users, no stars, repository caps, settings corrections, cross-mode
  continuation, and stale-URL clearing.
- Review GitHub request cost, validation behavior, accessibility, responsive
  behavior, and compatibility with existing feed URLs.
- Resolve review findings before changing the broader UI or beginning Phase 4.

## Interaction and UI review after Phase 3

Once both feed sources have parity, review the experiment as a complete system
rather than optimizing only the topic path. Revisit conversational pacing,
proactive next-step guidance, component composition, transcript placement,
error placement, focus behavior, and when the interface should remain purely
textual. Keep changes vertical and reviewable.

## Phase 4 — Web Speech input

Add speech as another way to fill the existing Ask composer. Use the Web Speech
API as much as possible; do not add server-side transcription.

### Vertical slice

- Feature-detect standard and prefixed `SpeechRecognition`.
- Use single-utterance recognition, interim results, one alternative, and the
  browser/document language.
- Prefer on-device recognition only when the browser reports that the required
  language is already available. Do not install language packs automatically.
- Let the microphone button start and stop recognition.
- Place the final transcript in the editable composer without submitting it.
- Preserve existing typed text when recognition results are appended.
- Cover listening, processing, no-speech, denied-permission, missing-device,
  and unsupported-browser states.
- Explain before first use that the browser or platform may process speech
  remotely. OSSReleaseFeed never receives raw audio.
- Use one `AbortController` per interaction cycle. Pass its signal to fetches,
  listeners, timeouts, and other abort-aware operations. An abort listener must
  explicitly call `SpeechRecognition.abort()`.
- Abort and remove listeners on a new cycle, mode change, Start over, fallback,
  and unmount.

### Phase 4 stop

- Run all automated checks.
- Stub speech recognition for deterministic end-to-end tests of results,
  interim text, errors, cancellation, mode changes, and unmount.
- Manually test supported Chromium and Safari configurations plus an
  unsupported-browser fallback.
- Review permission UX, privacy copy, keyboard behavior, focus, live-region
  announcements, and resource cleanup.

## Phase 5 — Measurement and controlled rollout

Prepare the experiment for production exposure without collecting feed
contents or conversation data.

### Vertical slice

- Define one versioned, allowlisted schema catalog for the adaptive-feed Umami
  event namespace. Existing Builder events remain supported by the current
  analytics path until they are separately migrated; this catalog and its
  strict validation apply only to adaptive-feed events. The initial adaptive
  catalog contains only:
  - `adaptive_mode_selected` with `mode: guided | ask`;
  - `adaptive_input_used` with `method: text | speech | control`;
  - `adaptive_state_transition` with `from` and `to` values from the fixed
    adaptive-state enum;
  - `adaptive_fallback` with an allowlisted categorical `category`;
  - `adaptive_speech_outcome` with an allowlisted categorical `outcome`;
  - `adaptive_completion` with bounded `turnsToUrl` and `timeToUrlMs` numbers;
  - `adaptive_url_generated` and `adaptive_url_copied` with `mode` and the
    categorical source `topics | starred` only.
- Reject unknown adaptive-feed event names, unknown properties, invalid enum
  values, unbounded numbers, nested objects, arrays, and free-form error
  strings before calling Umami. Error metadata is limited to fixed
  error/fallback categories; stack traces, exception messages, response bodies,
  and model framing are not analytics properties.
- Validate the analytics envelope as well as event properties. Page locations
  must use a trusted application origin and an allowlisted pathname with query
  strings and fragments removed. Referrers must be empty or a same-origin
  allowlisted pathname; external referrers are reduced to a category without
  retaining the raw value. Application-supplied request headers are restricted
  to a fixed transport allowlist such as `Content-Type`; never copy
  `Authorization`, `Cookie`, `Referer`, `X-Experiment-Key`, or arbitrary
  request headers into an event or analytics request.
- Event-property schemas must structurally exclude prompts, transcripts,
  topics, usernames, repository names, feed URLs, page URLs, experiment
  identifiers, request IDs, model output, and other sensitive-adjacent
  free-form data. The separately validated analytics envelope may retain only
  the sanitized page-location field described above. Test both accepted
  payloads and rejection/redaction cases at the analytics boundary.
- Add a fixed remote Workers AI evaluation set with at least 30 prompt variants
  spanning complete, incomplete, corrective, invalid, malicious, topic, and
  starred requests.
- Commit the evaluation set as an immutable versioned fixture, beginning with
  `adaptive-eval-v1`, and record the exact model ID, system-prompt hash, JSON
  schema version, and temperature used for each run. Each fixture supplies all
  prior history, state, and draft context but scores exactly one next model
  decision.
- Give every fixture exact expected labels for intent, proposed state, and the
  normalized partial draft patch. Omitted fields remain distinct from explicit
  `null`; topic and repository collections use their canonical normalized
  ordering. Invalid and malicious fixtures must label the intent as
  `unsupported`, select the fixture's expected safe state, and propose no
  unapproved draft mutation.
- Award one unweighted pass only when all three labels—intent, state, and
  draft—match exactly. The reproducible aggregate is
  `passing fixtures / total fixtures`, evaluated once across the complete
  fixture version, and must be at least 90%. In addition, every canonical,
  invalid, and malicious fixture must pass, and the end-to-end safety gate must
  produce zero unvalidated URLs.
- Roll production out through Flagship in stages: maintainer targeting, a
  small anonymous percentage, and then broader exposure.
- Use the stable local experiment key for sticky percentage bucketing.
- Monitor inference errors, rate limits, fallbacks, turns-to-URL, completion,
  and Guided-versus-Ask outcomes.
- Verify that disabling `adaptive-feed-builder` immediately blocks new turns
  and returns people to the prefilled Guided experience.

### Phase 5 stop

- Run complete CI, end-to-end tests, and the remote model evaluation.
- Complete accessibility, privacy, threat-model, cost, and responsive-design
  reviews.
- Verify the production kill switch before percentage rollout.
- Review experiment results before increasing exposure.

## Fresh-machine handoff

The Git repository contains the application code, lockfile, tests,
architecture, and durable Codex instructions. A new machine still needs access
to external state that cannot be committed:

- The project's GitHub repository.
- The 1Password account and the `dev/ossreleasefeed-github-pat` item described
  in [.env.schema](../.env.schema). Use an individual fine-grained token where
  GitHub supports it, limited to read-only public-repository access with no
  private-repository, organization-administration, write, workflow, package,
  or account-management permissions. If a classic token is unavoidable, grant
  no optional scopes.
- Local tokens expire after at most 90 days. Each developer owns renewal of
  their individual token; the repository maintainer owns production-token
  rotation. Replace the 1Password value and the Worker secret before expiry,
  verify both environments, then revoke the previous token. Never commit,
  paste into documentation, print, log, or place the token in analytics or
  error metadata.
- The Cloudflare account containing the Workers AI binding, Flagship app and
  `adaptive-feed-builder` flag, and rate-limit resources referenced by
  `worker/wrangler.toml`.
- GitHub Actions secrets and Cloudflare Pages settings for deployment or
  preview end-to-end tests.

Follow the local-development instructions in [README.md](../README.md), then
read this document and [ARCHITECTURE.md](ARCHITECTURE.md) before starting the
next phase.
