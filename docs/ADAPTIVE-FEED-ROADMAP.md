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

- Add anonymous Umami events for mode, input method, turns-to-URL,
  time-to-URL, state transitions, fallback category, speech outcome, URL
  generation, and copying.
- Never include prompts, transcripts, topics, usernames, repositories, URLs,
  or experiment identifiers in analytics.
- Add a fixed remote Workers AI evaluation set with at least 30 prompt variants
  spanning complete, incomplete, corrective, invalid, malicious, topic, and
  starred requests.
- Require all canonical journeys to pass, zero unvalidated URLs, and at least
  90% correct state/draft decisions across the broader fixture.
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
  in [.env.schema](../.env.schema).
- The Cloudflare account containing the Workers AI binding, Flagship app and
  `adaptive-feed-builder` flag, and rate-limit resources referenced by
  `worker/wrangler.toml`.
- GitHub Actions secrets and Cloudflare Pages settings for deployment or
  preview end-to-end tests.

Follow the local-development instructions in [README.md](../README.md), then
read this document and [ARCHITECTURE.md](ARCHITECTURE.md) before starting the
next phase.
