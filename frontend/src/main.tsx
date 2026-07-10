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
// rather than left uncovered. It requires an undocumented query param and has no
// effect on any real user flow.
function ThrowForErrorBoundaryTest(): never {
  throw new Error("Forced render error for error boundary e2e test");
}

const shouldThrowForTest = new URLSearchParams(window.location.search).has("__throw");

createRoot(rootElement).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={ErrorFallback}>
      {shouldThrowForTest ? <ThrowForErrorBoundaryTest /> : <App />}
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
