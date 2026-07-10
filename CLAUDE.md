# Project instructions for Claude

## Resource management

Always clean up timers, intervals, observers, and event listeners. Unmanaged resources cause memory leaks, degrade performance over time, and can leave stale callbacks running against unmounted components or deallocated state — a potential source of subtle security issues if those callbacks touch sensitive data or trigger network requests.

**In React components:**

- Store timer/interval IDs in a `useRef` and clear them at the top of every reschedule so rapid re-triggers never pile up stale callbacks.
- Return a cleanup function from every `useEffect` that registers a listener, starts a timer, or opens a subscription.
- Clear `useRef`-held timer IDs in a dedicated `useEffect(() => () => clearTimeout(ref.current), [])` so unmounting always cancels any pending reset.

**In plain TypeScript / Worker code:**

- Capture the return value of `setTimeout` / `setInterval` / `addEventListener` and pair every registration with an explicit teardown.
- Use `AbortController` for fetch calls and abort in cleanup so in-flight requests do not resolve after the context that issued them is gone.

## GitHub Actions workflows

Run `pnpm run lint:actions` before committing changes under `.github/workflows/`. It requires `actionlint` and `zizmor` on PATH (`brew install actionlint zizmor`); not part of the default `lint` script since CI doesn't have these binaries installed.
