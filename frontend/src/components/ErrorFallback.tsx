import type { FallbackRender } from "@sentry/react";

export const ErrorFallback: FallbackRender = ({ eventId, resetError }) => (
  <div className="error-fallback" role="alert">
    <h1 className="error-fallback__heading">Something went wrong</h1>
    <p className="error-fallback__message">
      OSSReleaseFeed hit an unexpected error. Reloading the page usually fixes it.
    </p>
    {eventId ? <p className="error-fallback__event-id">Reference: {eventId}</p> : null}
    <button
      className="error-fallback__reload btn-secondary"
      onClick={() => {
        resetError();
        window.location.reload();
      }}
      type="button"
    >
      Reload page
    </button>
  </div>
);
