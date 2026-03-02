# OSSReleaseFeed

**Version:** 1.1  
**Date:** 2026-02-28  
**Author:** Schalk Neethling  
**Status:** Final

---

> **Companion documents:** The technical implementation decisions captured in this PRD have been extracted into the [Technical Specification](ossreleasefeed-technical-spec.md) and [Implementation Plan](ossreleasefeed-implementation-plan.md). Those documents are the authoritative reference for how the system is built; this PRD defines what is being built and why.

## Executive Summary

OSSReleaseFeed is a lightweight, zero-authentication web tool that lets developers build personalised RSS/Atom feeds for open source activity on GitHub. Users provide a GitHub username or a set of topics, configure their preferences, and receive a single permanent feed URL they can drop into any feed reader. No account, no OAuth, no email — just a URL that works.

The tool targets developers who are already heavy feed reader users but lack a clean, focused way to follow OSS activity without the noise of the full GitHub notifications system. It revives a concept that has no strong modern equivalent, at a time when feed readers are seeing renewed interest.

The initial release validates the core value proposition — topic feeds and starred repo feeds — before investing in more complex infrastructure such as authenticated watched-repo feeds or user accounts.

- **What:** A stateless feed generation service producing Atom-compliant XML from GitHub public data
- **Why:** There is no frictionless way to aggregate OSS release and issue activity into a feed reader today
- **Who:** Developers who use feed readers and want to follow open source projects deliberately
- **When:** [TBD — initial beta target]
- **Success:** Sustained feed subscriptions after 30 days (feeds still being polled by readers)

---

## Background & Context

### Problem Statement

GitHub's notification and watching system surfaces a lot of activity, but it does not integrate with feed readers. The native Atom feeds GitHub provides (releases, commits, tags) are per-repository and undiscoverable. There is no way to follow a set of repositories or a topic ecosystem as a single feed without using a third-party aggregator or writing your own tooling.

### Current State

Developers who want to stay informed about OSS activity currently either receive noisy GitHub notification emails, manually check repository pages, follow aggregator newsletters with significant editorial lag, or write and self-host custom scripts. Each option has meaningful friction or blind spots.

### Market Opportunity

Feed reader usage has grown steadily since the demise of Google Reader created a committed niche of power users who migrated to tools like Feedbin, NetNewsWire, and Reeder. This audience is technically literate, already comfortable with feed URLs, and underserved specifically for OSS activity. A shareable topic feed URL also has organic distribution potential — a single link shared in a blog post or on Mastodon reaches the exact audience most likely to use the tool.

### Strategic Alignment

The project is a personal side project intended first to solve a genuine problem and second to validate user interest before any larger investment. The technology choices (Cloudflare Workers, Bun) are also an explicit goal: exploring these runtimes in a real-world context where the constraints are genuine rather than synthetic.

---

## Goals & Success Metrics

### Business Goals

- Validate that there is sustained user interest in OSS-specific feed aggregation with minimal investment
- Produce a reference implementation on Cloudflare Workers + Bun suitable for future projects
- Ship something real and shareable that can attract organic traffic

### User Goals

- Get a working feed URL with fewer than five steps and no account creation
- Follow one or more OSS topic ecosystems (e.g. `web-components`, `accessibility`) in one feed
- Follow one, more, or all of the repos they have starred on GitHub in one feed
- Control how frequently the feed refreshes to match their reading habits

### Success Metrics

| Metric | Baseline | Target | Timeline | Measurement Method |
|--------|----------|--------|----------|-------------------|
| Unique feed URLs generated | 0 | 200 | 30 days post-launch | Cloudflare Workers analytics |
| Feeds still active (polled) | — | 40% of generated | 30 days post-generation | Worker request logs |
| GitHub API rate limit headroom | — | >50% remaining at peak | Ongoing | Rate limit response headers |
| Feed generation p95 latency | — | <800ms | Ongoing | Cloudflare Workers analytics |
| Accessibility audit score | — | Zero critical issues, WCAG 2.1 AA | Pre-launch | axe / manual audit |

---

## User Personas & Use Cases

### Primary Persona: The Deliberate Developer

- **Profile:** Software developer, 5–20 years experience, uses a feed reader daily, follows open source ecosystems relevant to their work (e.g. web platform specs, accessibility tooling, their language's package ecosystem)
- **Behaviours:** Curates information sources carefully; dislikes noise; already stars repos on GitHub as a bookmarking habit; may have tried and abandoned GitHub's email notifications
- **Pain Points:** Cannot get a clean feed of releases from repos they care about; topic-based discovery requires manually checking GitHub Explore
- **Goals:** One feed URL per area of interest that surfaces releases and significant activity without requiring any ongoing maintenance

### Use Case 1: Topic Feed — Ecosystem Discovery

- **Actor:** Deliberate Developer
- **Preconditions:** User has a topic in mind (e.g. `web-components`) but may not have a specific list of repos
- **Flow:**
  1. User lands on OSSReleaseFeed and clicks "Create feed"
  2. Two option cards are presented: "Feed by topic" and "Feed by stars" — user selects "Feed by topic"
  3. The top 25 GitHub featured topics are displayed as a styled checkbox list; user selects any that apply
  4. User optionally types a custom topic into a search field; the tool performs a debounced lookup against the GitHub Topics API to confirm the topic exists before allowing it to be added to the selection
  5. Selects activity type: releases only, or all activity
  6. Selects cache/refresh interval (default: 24 hours)
  7. Receives a permanent Atom feed URL
  8. Copies URL into their feed reader
- **Success Criteria:** Feed reader receives valid Atom XML containing recent activity from repos tagged with those topics

### Use Case 2: Starred Repos Feed — Personal Curation

- **Actor:** Deliberate Developer
- **Preconditions:** User has a public GitHub account with starred repositories
- **Flow:**
  1. User lands on OSSReleaseFeed and clicks "Create feed"
  2. Two option cards are presented: "Feed by topic" and "Feed by stars" — user selects "Feed by stars"
  3. A username input field is revealed; user enters their GitHub username
  4. The tool fetches and displays the user's starred repos as a filterable, selectable list; the user may deselect any repos they do not want included in the feed, or proceed with all selected
  5. Selects activity type and cache interval
  6. Receives a permanent Atom feed URL
  7. Copies URL into their feed reader
- **Success Criteria:** Feed reader receives valid Atom XML reflecting only the selected subset of the user's starred repos

---

## Functional Requirements

### P0 — Must Have for Launch

**REQ-001: Topic Feed Generation**
- **Description:** A user can select from a list of featured GitHub topics and/or enter custom topic slugs, then receive a valid Atom 1.0 feed URL containing release activity from repositories tagged with those topics. The feed is generated on request and cached server-side.
- **User Story:** As a developer, I want to follow everything tagged `accessibility` on GitHub so that I discover new projects and stay current on releases without curating a list manually.
- **Acceptance Criteria:**
  - [ ] The top 25 GitHub featured topics are fetched from the GitHub Topics API on page load and presented as a styled checkbox list
  - [ ] Checkboxes are implemented using native `<input type="checkbox">` elements; custom styling does not interfere with keyboard or assistive technology operation
  - [ ] A separate input field allows the user to search for and add topics not present in the featured list (see REQ-008)
  - [ ] User can select 1–5 topics in total (featured + custom combined)
  - **Note on the topic cap:** 5 was chosen as a pragmatic starting point to limit GitHub API fan-out per feed generation and protect rate limit headroom. It is not an arbitrary UX constraint — but it is an unvalidated one. The right approach is to ship with 5, gather user feedback on whether the cap is a barrier to adoption, and consider an A/B test comparing 5 and 10 topics to see whether users actually make use of the additional capacity when it is available. Any change to this limit should be informed by rate limit data from the technical spike and real usage patterns post-launch.
  - [ ] The number of repositories fetched per topic is capped at 25 (the top 25 most relevant results as returned by the GitHub Search API); this is surfaced to the user as "your feed will include the top 25 most relevant repositories for each topic" rather than framed as a technical limitation
  - **Note on the per-topic repository cap:** 25 is the proposed default for the technical spike. The worst-case API cost at launch is 5 topics × 25 repos = 125 repositories per feed generation on a cache miss. This must be pressure-tested against the rate limit budget during the spike before the number is finalised. See Open Question 5.
  - [ ] Feed is valid Atom 1.0 (passes W3C feed validator)
  - [ ] Feed URL is stable and permanent for a given configuration
  - [ ] Feed is served with correct `Content-Type: application/atom+xml` header
  - [ ] If the selected topics return no matching repositories, a clear message is shown with suggestions to adjust the selection; feed URL generation is blocked as an empty feed is not useful to the user
- **Dependencies:** GitHub Search API (`/search/repositories?q=topic:X`), GitHub Topics API (`/search/topics?q=is:featured`), REQ-005 (URL encoding), REQ-007 (caching), REQ-008 (custom topic validation)

**REQ-002: Starred Repos Feed Generation**
- **Description:** A user can enter a GitHub username and receive a valid Atom 1.0 feed URL reflecting release activity from that user's public starred repositories.
- **User Story:** As a developer, I want a feed based on my GitHub stars so that my existing curation work on GitHub becomes useful in my feed reader.
- **Acceptance Criteria:**
  - [ ] User can enter any valid GitHub username
  - [ ] Tool fetches the user's public starred repos via `/users/{username}/starred`
  - [ ] The fetched repos are always presented to the user as a filterable list (see REQ-009) before the feed URL is generated
  - [ ] Feed is valid Atom 1.0
  - [ ] Non-existent or private-only usernames surface a clear, accessible error message
  - [ ] If the user has no public starred repositories, a clear message is shown explaining this and feed URL generation is blocked; no feed URL is offered
- **Dependencies:** GitHub Users API, REQ-005, REQ-007, REQ-009

**REQ-009: Starred Repos Filterable List**
- **Description:** After a valid username is entered, the tool always fetches and displays the user's starred repos as a filterable, selectable list. The user may deselect individual repos they do not want included in the feed, or proceed with all repos selected. This step is required — it is not optional — as it gives the user full visibility into and control over what will be in their feed before the URL is generated.
- **Acceptance Criteria:**
  - [ ] The list is always shown after a valid username is confirmed; it cannot be skipped
  - [ ] All repos are selected by default; the user opts out rather than opts in
  - [ ] The number of repos a user can include in their feed is capped at 25; if the user has more than 25 starred repos they can select any 25 from the full list
  - **Note on the starred repo cap:** Unlike the topic fan-out case, each starred repo is a direct repository — there is no fan-out. The cap here is primarily about feed usefulness and predictable API cost rather than rate limit protection. 25 is the starting point; an A/B test comparing 25 and 50 is the intended validation path.
  - [ ] "Select all" / "Deselect all" controls are provided
  - [ ] List is filterable by repo name/owner in real time
  - [ ] Each item shows repo name, owner, and star count
  - [ ] List is fully keyboard navigable
  - [ ] For users with more than 25 starred repos, the list initially displays the first 25 results; a "Load more" button appends the next batch without replacing the existing list or losing the user's current selections
- **Dependencies:** REQ-002

**REQ-003: Activity Type Selection**
- **Description:** The intent is for users to be able to select what type of GitHub activity to include in their feed: releases only, or releases plus issues and pull requests. For starred repo feeds this is reasonably straightforward since the tool operates against a known list of repositories. For topic feeds this has not yet been validated — it may require a per-repo fan-out that has meaningful rate limit and latency implications. This requirement should not be treated as fully specified until the technical spike confirms feasibility for both feed types. See the caveat and Open Question 5 below.
- **Caveat:** For starred repo feeds, activity type filtering is straightforward — the tool works against a known list of repos and can call the appropriate endpoint per repo. For topic feeds, this is less certain: GitHub does not expose a native per-topic Atom feed with activity type filtering. Serving anything beyond "releases only" for a topic feed will likely require fetching the list of repos matching the topic, then making per-repo API calls for each activity type, and aggregating the results. This has meaningful implications for API rate limit consumption and response latency and must be validated before this requirement is fully specified for the topic feed path. See Open Question 5.
- **Acceptance Criteria:**
  - [ ] "Releases only" option uses GitHub's native `/releases.atom` endpoint per repo
  - [ ] "Releases + Issues & PRs" option additionally fetches from `/repos/{owner}/{repo}/issues` REST endpoint
  - [ ] Selected activity type is encoded in the feed URL config
  - [ ] Feed entries clearly indicate in their title whether an entry is a release, issue, or PR (e.g. `[whatwg/html] Release: 2024-01-15` vs `[whatwg/html] PR: ...`)
  - [ ] If "all activity" is not technically feasible for topic feeds within rate limit constraints, the activity type selector is restricted to "releases only" for the topic feed path, with a clear explanation surfaced in the UI
- **Dependencies:** REQ-001 or REQ-002

**REQ-004: Cache / Refresh Interval Selection**
- **Description:** The user selects how frequently the server-side cache for their feed is invalidated. A server-enforced minimum prevents abuse.
- **Acceptance Criteria:**
  - [ ] Available options: 1 hour, 6 hours, 12 hours, 24 hours (default), 48 hours
  - [ ] Server enforces a minimum of 1 hour regardless of any value in the URL
  - [ ] Selected TTL is encoded in the feed URL config
  - [ ] Cache TTL is respected per unique feed configuration, not per IP
- **Dependencies:** REQ-007

**REQ-005: Stateless Base64-Encoded Feed URLs**
- **Description:** Feed configuration is encoded as a base64 URL-safe string and embedded in the feed URL path. No server-side user records are required.
- **Acceptance Criteria:**
  - [ ] Config object (source type, repos/topics, activity type, TTL) is JSON-serialised and base64url-encoded
  - [ ] Server decodes and validates the token on each request; malformed tokens return HTTP 400 with a human-readable error
  - [ ] Encoded URL contains no sensitive information (no tokens, no emails)
  - [ ] URL format: `/feed/{base64url-encoded-config}`
  - [ ] Same config always produces the same URL (deterministic encoding)
- **Dependencies:** None

**REQ-006: Valid Atom 1.0 Output**
- **Description:** All generated feeds conform to the Atom Syndication Format (RFC 4287) so they work in any standards-compliant feed reader without modification.
- **Acceptance Criteria:**
  - [ ] Feed passes the W3C Feed Validation Service
  - [ ] Feed includes required Atom elements: `<feed>`, `<id>`, `<title>`, `<updated>`, `<link rel="self">`
  - [ ] Each entry includes: `<id>`, `<title>`, `<link>`, `<updated>`, `<author>`, `<summary>`
  - **Note on `<author>`:** This should not map to the repository name — the repository is already identified in the entry `<title>` and `<link>`. The intended mapping is the GitHub user who published the release (for release entries) or the GitHub user who opened the issue or PR (for issue and PR entries). However, this depends on the GitHub API returning sufficiently granular authorship data for each activity type, which has not yet been verified. If the API does not reliably expose this, a fallback of the repository owner (i.e. `owner/repo`) is acceptable, and this should be documented in the technical specification once confirmed.
  - [ ] Special characters in titles and summaries are correctly escaped
  - **Note on sanitization approach:** The HTML Sanitizer API (`Element.setHTML()`, `Document.parseHTML()`) is the emerging web platform standard for this and should be the target approach. However, as of early 2026 it is experimental — available in Firefox, partially in Chrome, and absent in Safari. Research whether a reliable polyfill exists (DOMPurify is the established prior art that the Sanitizer API is designed to eventually replace, and is likely the most credible fallback). Determine the appropriate strategy — native API with polyfill, DOMPurify only, or progressive enhancement — and document the decision in the technical specification. Reference: [MDN — HTML Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API).
  - [ ] `Content-Type` header is `application/atom+xml; charset=utf-8`
  - [ ] Each entry's `<id>` is a stable, permanent URI derived from the source content (e.g. the GitHub release or issue URL); the same piece of content always produces the same `<id>` across refreshes
  - [ ] The feed-level `<updated>` timestamp reflects the date of the most recent entry in the feed, not the time the feed was generated; a refresh that yields no new content must not change this timestamp
- **Dependencies:** None

**REQ-007: Server-Side Caching & Incremental Feed Updates**
- **Description:** Feed responses are cached at the edge using the Cloudflare Cache API, keyed on the full feed URL. This protects against GitHub API rate limits and improves response times for shared/popular feeds. Critically, when a cached feed is refreshed, only genuinely new content is appended — stale entries are not re-emitted in a way that causes feed readers to treat them as unread.
- **Acceptance Criteria:**
  - [ ] Cache key is the full request URL
  - [ ] Cache TTL respects the TTL encoded in the feed config (minimum 1 hour)
  - [ ] Cache miss triggers a fresh fetch from GitHub and populates the cache
  - [ ] On a cache miss, the Worker compares freshly fetched entries against the previously cached feed using entry `<id>` values; only entries not present in the previous feed are treated as new
  - [ ] If no new entries are found, the regenerated feed is byte-for-byte identical to the cached feed (same `<updated>`, same entries, same order); a feed reader polling this feed must not surface it as containing new content
  - [ ] A single server-side PAT is used for all GitHub API requests; it is never exposed to the client
  - [ ] If GitHub API returns a rate limit error (429), the Worker returns the previous cached feed response unchanged with a `Retry-After` HTTP response header indicating when the next attempt will be made; an empty feed is never served in this scenario as it would cause feed readers to treat previously seen entries as removed
- **Dependencies:** REQ-005, REQ-006

### P1 — Should Have

**REQ-008: Custom Topic Validation & Addition**
- **Description:** Alongside the featured topics checkbox list, a search field allows users to add topics that are not in the featured list. The field performs a debounced real-time lookup against the GitHub Topics API to confirm a topic exists on GitHub before permitting the user to add it to their selection. Clear feedback is provided at each state.
- **Acceptance Criteria:**
  - [ ] Validation is debounced at 400–500ms after the user stops typing to avoid excessive API requests
  - [ ] While the lookup is in progress, a loading indicator is shown within the field
  - [ ] If the topic exists, a success state is shown and the "Add topic" button becomes active
  - [ ] If the topic does not exist, an error message is shown inline (e.g. "No GitHub topic found matching '{value}'") and the "Add topic" button remains disabled
  - [ ] Error and success messages are associated with the field via `aria-describedby` and announced via a live region
  - [ ] Attempting to add a topic already in the selection (featured or custom) is rejected with an appropriate inline message
  - [ ] Added custom topics appear as removable tags adjacent to the input; each tag has a labelled remove button
  - [ ] Pressing Enter while the "Add topic" button is active triggers the add action
- **Dependencies:** REQ-001, GitHub Topics API (`/search/topics?q={query}`)

**REQ-010: Feed URL Display and Copy Button**
- **Description:** The generated feed URL is displayed in a visible, accessible, and copyable form alongside a one-click copy button. The specific element used to display the URL should be determined during the technical specification phase — the semantically correct choice is likely an `<a>` element rather than a `readonly` input, as the URL is a link to follow rather than a value to edit. The copy button is a convenience enhancement on top of an independently meaningful and functional URL.
- **Acceptance Criteria:**
  - [ ] The feed URL is fully visible or scrollable if it exceeds the available width
  - [ ] The URL is accessible and operable by keyboard and assistive technology without reliance on the copy button
  - [ ] The element used to display the URL conveys the correct semantic meaning; a `readonly` input should not be used unless there is a clear justification documented in the technical specification
  - [ ] The copy button uses the Clipboard API (`navigator.clipboard.writeText`)
  - [ ] The copy button provides visible and programmatic confirmation on success (e.g. label changes to "Copied!" for 2 seconds)
  - [ ] If the Clipboard API is unavailable, the URL remains accessible and selectable for manual copy
- **Dependencies:** REQ-005

### P2 — Nice to Have

**REQ-011: QR Code for Feed URL**
- **Description:** A QR code of the feed URL is generated client-side so users on mobile feed readers can scan it directly.
- **Acceptance Criteria:**
  - [ ] QR code is generated entirely client-side (no third-party image service)
  - [ ] QR code is rendered as an `<svg>` for resolution independence
  - [ ] Alt text or `<title>` within the SVG describes the feed for screen readers
- **Dependencies:** REQ-005, REQ-010

**REQ-012: Feed Preview**
- **Description:** After generating a URL, the tool shows a preview of the first 5 entries the feed currently contains so users can verify the feed looks correct before subscribing.
- **Acceptance Criteria:**
  - [ ] The preview is fetched by making a GET request to the generated feed URL from the client; the response is the same Atom XML that any feed reader would receive. The `DOMParser` API is the recommended approach for parsing the Atom XML response on the client before rendering the preview entries — no third-party library should be needed for this. Confirm browser support and document the approach in the technical specification.
  - [ ] While the preview is loading, a loading indicator is shown in place of the entry list within the preview area, consistent with the feedback proximity principle
  - [ ] Once loaded, up to 5 entries are displayed in an accessible list; each entry shows the title, source repository, and date
  - [ ] If the feed returns zero entries, a message is shown within the preview area explaining that no activity was found for the current configuration, with a suggestion to broaden the topic selection or check back later
  - [ ] If the fetch fails (network error, non-200 response), an error message is shown within the preview area; the generated URL remains visible and usable so the user can still subscribe manually
- **Dependencies:** REQ-006

**REQ-013: JSON Feed 1.1 Output**
- **Description:** In addition to Atom 1.0, the service can generate feeds in the JSON Feed 1.1 format. This is the intended first feature addition after the initial proof of concept is validated, and is not in scope for the POC release. JSON Feed has strong adoption among the feed readers most likely to be used by the target persona (NetNewsWire, Reeder, Feedbin, Miniflux) and is significantly easier to consume for any developer who wants to process the feed programmatically. Since the underlying data model is identical to the Atom output, this is purely a new serialisation path and requires no changes to feed generation logic, caching, or URL config.
- **Acceptance Criteria:**
  - [ ] JSON Feed output conforms to the JSON Feed 1.1 specification (jsonfeed.org)
  - [ ] Feed format is selected via a `format` parameter in the feed config, defaulting to `atom`
  - [ ] The same base64-encoded config produces either format depending on the `format` value; all other config fields are shared
  - [ ] JSON Feed output is served with `Content-Type: application/feed+json; charset=utf-8`
  - [ ] All feed integrity requirements from REQ-006 and REQ-007 apply equally to JSON Feed output (stable entry IDs, content-aware `date_modified`, incremental updates only)
  - [ ] The builder UI offers the user a choice of output format before generating the URL
  - [ ] Feed passes validation against a JSON Feed validator. Reference: [JSON Feed Validator](https://validator.jsonfeed.org).
- **Dependencies:** REQ-005, REQ-006, REQ-007
- **Note:** Targeted as the first post-POC release. Do not begin implementation until Atom-based POC is live and validated. Reference: [Mapping RSS and Atom to JSON Feed](https://www.jsonfeed.org/mappingrssandatom/) — a first-party guide to mapping Atom fields to their JSON Feed equivalents, which will inform the serialisation work directly.

---

## User Experience & Design

### Design Philosophy

The UI takes inspiration from the visual language of workflow tools (Zapier, IFTTT, n8n) — a step-by-step builder that makes the configuration feel guided rather than form-like — while prioritising accessibility over novelty at every decision point. If an interaction pattern cannot be made fully accessible, the simpler accessible version wins.

**Feedback proximity** is a first-class design principle throughout. All feedback — validation states, loading indicators, error messages, success confirmations — must be surfaced as close as possible to the element that triggered it. A loading spinner belongs inside the input field being validated, not in a remote corner of the page. An error message belongs immediately below the field it relates to, not in a global notification area. This principle applies equally to visual design and markup structure. It reduces cognitive load, makes the interface more accessible, and ensures users never have to hunt for feedback on an action they just took.

**Visual design guidance:** Before making any design or implementation decisions, designers and developers should read the [Anthropic Frontend Design Skill](https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/frontend-design/SKILL.md). Key principles to carry into this project: commit to a clear, distinctive aesthetic direction before writing a line of code; use characterful typography rather than generic system fonts; use CSS custom properties for all theming; favour intentional motion that serves the user over decorative animation; and avoid the generic "AI-generated" aesthetic of purple gradients, predictable layouts, and safe colour choices. The target persona is a developer — the aesthetic should feel at home in that world without defaulting to clichés of developer tooling.

### Key User Flow

```
Landing page
  → Click "Create feed"
  → Two option cards: "Feed by topic" / "Feed by stars"
      → [Feed by topic]
            Featured topics checkbox grid (top 25)
          + Custom topic input with real-time validation (REQ-008)
          → Select activity type
          → Select TTL
          → Get URL + copy button
      → [Feed by stars]
            Enter GitHub username (with real-time validation)
          → (Optional) Filter starred repos list
          → Select activity type
          → Select TTL
          → Get URL + copy button
```

The builder is a single page. Each step is revealed progressively as the previous step is completed. The final step is the generated URL with a copy button, unless an error occurred during feed generation, in which case a clear error message is shown in place of the URL with guidance on what the user can do next.

### Interaction Patterns

- The entry point is a single "Create feed" button on the landing page; no mode selection is visible until the user signals intent by clicking it
- Mode selection is presented as two distinct option cards ("Feed by topic", "Feed by stars") rather than a toggle or dropdown, making each path's purpose scannable at a glance
- Step-by-step progressive disclosure follows mode selection — each subsequent step is revealed only once the prior step is sufficiently complete
- Each step is a clearly labelled `<fieldset>` with a `<legend>`
- The featured topics step uses native `<input type="checkbox">` elements styled as pill tags; the native semantics are preserved so no ARIA is needed for the checkbox role itself
- The custom topic input uses a validate-and-add pattern rather than a dropdown autocomplete: the user types a topic, the tool confirms it exists on GitHub in real time, and the user explicitly adds it. This avoids the accessibility complexity of a combobox widget and matches the mental model of "I know what I want, confirm it exists"
- Native HTML controls (`<input>`, `<select>`, `<button>`) are used throughout; no custom widgets unless native equivalents do not exist
- The username input for the starred repos path validates the GitHub username in real time using the same debounced pattern as the custom topic input

### Accessibility Requirements

- [ ] WCAG 2.1 Level AA compliance at minimum
- [ ] All interactive elements reachable and operable by keyboard alone
- [ ] Focus order follows the logical reading order of the page
- [ ] All form inputs have visible, associated `<label>` elements — no `placeholder`-only labels
- [ ] Error messages are associated with their field via `aria-describedby` and announced to screen readers
- [ ] Colour is never the sole means of conveying information
- [ ] Minimum contrast ratio of 4.5:1 for normal text, 3:1 for large text and UI components
- [ ] All interactive components tested with VoiceOver (macOS/iOS) and NVDA (Windows)
- [ ] Reduced motion media query respected for any transitions or animations
- [ ] No content relies solely on hover; all hover affordances have a keyboard/focus equivalent

### Responsive Design

The tool is a single-column layout and should be fully functional at any viewport width from 320px upward. No functionality is hidden or degraded on mobile — the feed URL is as useful on a phone as on a desktop.

### Error States & Edge Cases

- Invalid GitHub username → inline error message on blur, field remains editable
- Username with no public stars → clear message explaining the user has no public starred repositories; feed URL generation is blocked as there is nothing useful to generate
- GitHub API unavailable → user-facing message explaining the service is temporarily unable to reach GitHub; no broken UI
- Malformed feed URL accessed directly → HTTP 400, human-readable error page (not a blank screen)
- Topics that return no matching repositories → a clear message is shown explaining that no repositories were found for the current topic selection, with suggestions to adjust the selection (change topics, switch between all/any matching, or reduce the number of topics); feed URL generation is blocked as there is nothing useful to generate

---

## Dependencies & Risks

### External Dependencies

| Dependency | Vendor | Status | Contingency Plan |
|------------|--------|--------|------------------|
| GitHub REST API | GitHub (Microsoft) | Stable, versioned | Cache stale responses; surface clear error if API is down |
| GitHub Atom feeds | GitHub (Microsoft) | Stable but undocumented | Per-repo release feeds have been stable for years; monitor for breakage |
| Cloudflare Workers | Cloudflare | GA | Standard service; no realistic contingency needed for a side project |
| Bun (local dev/build) | Oven | Maturing | Fall back to Node.js 22 if Bun compatibility with Workers tooling is a blocker |

### Risks & Mitigation

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| GitHub removes or breaks Atom feeds for releases | Low | High | Monitor; REST API fallback exists (`/releases` endpoint) |
| GitHub API rate limiting at scale | Medium | Medium | Aggressive edge caching; single authenticated PAT; TTL floor |
| Bun incompatibility with Cloudflare Workers build pipeline | Medium | Low | Bun is a DX choice, not a runtime requirement; Node.js is a drop-in fallback |
| Low user adoption | Medium | Low | This is the primary thing we are validating; low investment by design |
| Spam/abuse of feed generation endpoint | Low | Medium | TTL floor prevents rapid repeated requests; no user data at risk |

---

## Timeline & Milestones

| Milestone | Description |
|-----------|-------------|
| PRD v1 agreed | Core scope locked for initial build |
| Technical spike | Validate Bun + Cloudflare Workers local dev setup; confirm GitHub API endpoints behave as expected |
| P0 implementation | Worker routing, feed generation, base64 config, caching |
| UI implementation | Step-by-step builder, P0 interactions, accessibility audit |
| Beta | Deployed to production Workers, shareable for feedback |
| P1 implementation | Custom topic validation, starred repo filter list, copy button refinements |
| Public launch (POC) | Blog post, share on relevant communities; validate sustained user interest |
| JSON Feed (REQ-013) | First post-POC feature: JSON Feed 1.1 output format alongside existing Atom output |
| P2 implementation | QR code, feed preview, and any further enhancements informed by POC feedback |

Dates are [TBD] — this is a side project with no fixed deadline.

---

## Open Questions

1. **Bun as build tool vs. runtime:** Cloudflare Workers runs on V8 isolates. Does `bun build` produce output that Wrangler (the Workers CLI) can deploy without issues? Needs a spike before committing to Bun.
   - **Owner:** Schalk
   - **Deadline:** Before technical implementation begins

2. **GitHub topic Atom feeds:** Does GitHub expose any Atom/RSS feed for topics directly (e.g. `github.com/topics/web-components.atom`)? If so, this simplifies REQ-001 significantly. Needs verification.
   - **Owner:** Schalk
   - **Deadline:** Before REQ-001 implementation

3. **Watched repos endpoint visibility:** If a "watched repos" feature is built later, is `/users/{username}/subscriptions` still publicly accessible by username or does it now require the authenticated user themselves? Noted for future phase.
   - **Owner:** Schalk
   - **Deadline:** Before Phase 2 planning

5. **Activity type filtering for topic feeds and per-topic repository cap:** GitHub does not appear to expose a native per-topic Atom feed with activity type filtering. Serving "releases + issues & PRs" for a topic feed will likely require fetching the repo list for each topic, then making per-repo API calls for each activity type, and aggregating the results. This needs to be validated during the technical spike alongside the per-topic repository cap. The proposed default cap is 25 repos per topic, giving a worst-case cost of 5 topics × 25 repos = 125 API calls per feed generation on a cache miss. Key questions: is this within the rate limit budget at expected traffic levels, is the p95 latency acceptable at that fan-out, and does "all activity" remain feasible within those constraints? If not, "all activity" may need to be restricted to starred repo feeds only for the initial release, and/or the per-topic repo cap may need adjusting.
   - **Owner:** Schalk
   - **Deadline:** During the technical spike, before REQ-003 implementation

---

## Appendix

### Competitive Landscape

No direct equivalent exists today. Tangentially related tools include:

- **GitHub's native per-repo Atom feeds** — exist but are undiscoverable, per-repo only, and not aggregatable without tooling
- **RSS aggregators (Feedbin, Inoreader)** — consume feeds but do not generate GitHub-specific ones
- **Morning Dew / changelog newsletters** — editorial, not personalised, not real-time

### Glossary

- **Atom:** The Atom Syndication Format (RFC 4287), an XML-based feed format. Preferred over RSS 2.0 for its cleaner specification and unambiguous date handling. The primary output format for this project.
- **JSON Feed:** A feed format specification (version 1.1, jsonfeed.org) that expresses the same feed concepts as Atom but in JSON rather than XML. Widely supported by modern feed readers and easier to generate and consume programmatically. Targeted as the first post-POC addition (REQ-013). Reference: [Mapping RSS and Atom to JSON Feed](https://www.jsonfeed.org/mappingrssandatom/).
- **Feed reader:** An application that polls Atom/RSS feed URLs and presents new entries to the user (e.g. NetNewsWire, Reeder, Feedbin, Miniflux).
- **PAT:** Personal Access Token — a GitHub credential used server-side to authenticate API requests and access a higher rate limit.
- **TTL:** Time To Live — the duration for which a cached feed response is considered fresh before being re-fetched from GitHub.
- **Topic (GitHub):** A tag applied to a GitHub repository to categorise it by ecosystem, language, or purpose (e.g. `accessibility`, `web-components`).
- **Stateless feed URL:** A feed URL that encodes all configuration needed to generate the feed within the URL itself, requiring no server-side user record.

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-02-28 | Schalk Neethling | Initial draft |
| 1.1 | 2026-02-28 | Schalk Neethling | Revised UI entry flow: single "Create feed" CTA → option cards for mode selection. Updated Use Cases 1 & 2, Key User Flow diagram, and Interaction Patterns to reflect this. Updated REQ-001 to include featured topics checkbox grid (top 25 from GitHub Topics API). Replaced REQ-008 autocomplete combobox with validate-and-add pattern. Updated API endpoints and Integration Points accordingly. Corrected User Goals wording to "one or more OSS topic ecosystems" and "one, more, or all of the repos they have starred". Added feasibility caveat and fallback acceptance criterion to REQ-003 for activity type filtering on topic feeds. Added stable entry `<id>` and content-aware `<updated>` requirements to REQ-006. Renamed REQ-007 to reflect incremental update behaviour; added criteria ensuring a refresh with no new content produces an identical feed. Added Open Question 5 on topic feed activity type feasibility. Promoted REQ-009 (Starred Repos Filterable List) from P1 to P0; clarified that presenting the list is always required after username entry — filtering is optional, showing the list is not. Updated REQ-002 and Use Case 2 accordingly. Added REQ-013 (JSON Feed 1.1) as P2, designated as the first post-POC feature; updated Timeline and Glossary accordingly. |
| 1.2 | 2026-02-28 | Schalk Neethling | Finalised PRD. Removed Technical Considerations section (Architecture Overview, Runtime & Tooling, Integration Points, Data Model, Non-Functional Requirements, Security & Compliance, APIs & Endpoints) — all content moved to Technical Specification v1.0. Updated status to Final. Added companion document references. |
