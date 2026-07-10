import * as Sentry from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorFallback } from "./components/ErrorFallback";
import { initSentry } from "./lib/sentry";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/error-fallback.css";

initSentry();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

// No component-testing harness exists in this project (Playwright only), so the
// ErrorBoundary's fallback path is exercised end-to-end via this opt-in trigger
// rather than left uncovered. Gated behind a build-time flag (unset in production
// builds) plus the query param, so the crash cannot be triggered in production.
function ThrowForErrorBoundaryTest(): never {
  throw new Error("Forced render error for error boundary e2e test");
}

const testHooksEnabled = import.meta.env.VITE_E2E_TEST_HOOKS === "true";
const shouldThrowForTest =
  testHooksEnabled && new URLSearchParams(window.location.search).has("__throw");

createRoot(rootElement).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={ErrorFallback}>
      {shouldThrowForTest ? <ThrowForErrorBoundaryTest /> : <App />}
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
