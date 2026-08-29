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
