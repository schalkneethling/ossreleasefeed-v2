# Acceptance scenarios

These Gherkin features are the shared contract for manual checks and automated
integration coverage. They describe behavior at trusted boundaries rather than
model wording: visible UI, validated workspace state, API calls, active WebMCP
tools, and canonical feed URLs.

## Tags

- `@manual` — suitable for a human test pass against a local or preview build.
- `@playwright` — browser behavior that belongs in `tests/e2e`.
- `@worker` — request/response behavior that belongs in the Worker integration suite.
- `@webmcp` — requires a WebMCP-capable browser host or the test model-context harness.
- `@regression` — derived from a previously observed failure or race.

Each scenario also has a stable journey tag such as `@webmcp_001`. Automated
test titles should include that tag when the scenario is implemented so a
failed test can be traced back to its acceptance contract.

## Vocabulary

- **Feed-building session** means the current browser-local application state:
  the validated configuration, displayed feed URL, conversation, UI state, and
  revision. The implementation currently persists this state in local storage;
  it is not a server-side workspace or stored feed record.
- **Generated feed URL** means an immutable, stateless URL whose token encodes
  one validated feed configuration. Revising a configuration generates a
  different URL; it does not modify or invalidate a previously generated URL.
- **Shown** and **not shown** describe only the URL selected for display in the
  current feed-building session. They make no claim about whether another URL
  remains independently usable.

## Coverage map

| Journey              | Current automated coverage                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| `webmcp_001`         | `tests/e2e/webmcp.spec.ts`                                                      |
| `webmcp_002`         | `tests/unit/webmcp.test.ts`; browser coverage to add                            |
| `webmcp_003`         | `tests/unit/webmcp.test.ts`; browser coverage to add                            |
| `adaptive_topic_001` | `tests/e2e/adaptive-feed.spec.ts`                                               |
| `adaptive_topic_002` | `tests/e2e/adaptive-feed.spec.ts`                                               |
| `adaptive_topic_003` | `tests/e2e/adaptive-feed.spec.ts`                                               |
| `starred_001`        | `tests/integration/worker-routes.test.ts` and `tests/e2e/adaptive-feed.spec.ts` |
| `starred_002`        | `tests/integration/worker-routes.test.ts` and `tests/e2e/adaptive-feed.spec.ts` |
| `starred_003`        | `tests/e2e/starred-step.spec.ts` and `tests/e2e/adaptive-feed.spec.ts`          |

Fixtures use deterministic GitHub responses and fake assistant responses. A
manual pass may substitute real public topics or users, but must preserve the
observable outcome and must not rely on exact assistant prose unless the
scenario explicitly quotes it.
