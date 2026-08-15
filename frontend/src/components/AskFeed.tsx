import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { INTERACTION_TIMEOUT_REASON, useInteractionCycle } from "../hooks/useInteractionCycle";
import {
  ASSISTANT_MESSAGE_LIMIT,
  getExperimentKey,
  submitAssistantTurn,
  type AdaptiveState,
  type AssistantHistoryTurn,
  type AssistantTurnResponse,
  type FeedDraft,
  type FeedTtl,
} from "../lib/assistant";
import { AssistantApiError } from "../lib/error";
import { AdaptiveStage } from "./AdaptiveStage";
import "../styles/adaptive-entry.css";

const REQUEST_TIMEOUT_MS = 15_000;

type AskFeedProps = {
  active: boolean;
  composer: string;
  draft: FeedDraft;
  feedUrl: string | null;
  issues: string[];
  showUi: boolean;
  state: AdaptiveState;
  ttlSelected: boolean;
  transcript: AssistantHistoryTurn[];
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onAssistantResult: (userMessage: string, response: AssistantTurnResponse) => void;
  onComposerChange: (composer: string) => void;
  onGenerate: () => void;
  onGuidedFallback: (disabled: boolean) => void;
  onSourceChange: (source: FeedDraft["source"]) => void;
  onStartOver: () => void;
  onTopicsChange: (topics: string[]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
};

const formatRetryDelay = (seconds: number | null): string => {
  if (seconds === null) {
    return "Wait before trying again.";
  }

  return `Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
};

export function AskFeed({
  active,
  composer,
  draft,
  feedUrl,
  issues,
  showUi,
  state,
  ttlSelected,
  transcript,
  onActivityChange,
  onAssistantResult,
  onComposerChange,
  onGenerate,
  onGuidedFallback,
  onSourceChange,
  onStartOver,
  onTopicsChange,
  onTtlChange,
}: AskFeedProps) {
  const [conversationOpen, setConversationOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAnnouncement, setLastAnnouncement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();
  const counterId = useId();
  const formLegendId = useId();
  const experimentKeyRef = useRef(getExperimentKey());
  const { beginCycle, cancelCycle, completeCycle } = useInteractionCycle(REQUEST_TIMEOUT_MS);
  const characterCount = composer.length;
  const charactersRemaining = ASSISTANT_MESSAGE_LIMIT - characterCount;
  const messageTooLong = charactersRemaining < 0;
  const characterFeedback = messageTooLong
    ? `${ASSISTANT_MESSAGE_LIMIT} character count limit exceeded — ${characterCount} characters entered (${charactersRemaining} characters remaining)`
    : `${charactersRemaining} characters remaining`;
  const announcement = error
    ? error
    : submitting
      ? "Interpreting and validating your request"
      : lastAnnouncement;

  useEffect(() => {
    if (!active) {
      cancelCycle();
    }
  }, [active, cancelCycle]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();

    const trimmed = composer.trim();

    if (!trimmed) {
      setError("Enter a request before sending it.");
      return;
    }

    if (messageTooLong) {
      setError(
        `Your request exceeds the ${ASSISTANT_MESSAGE_LIMIT} character limit. Shorten it before trying again.`,
      );
      return;
    }

    const controller = beginCycle();
    setSubmitting(true);
    setError(null);
    setLastAnnouncement("");

    try {
      const response = await submitAssistantTurn(
        {
          message: trimmed,
          history: transcript.slice(-6),
          state,
          draft,
          issues,
          ttlSelected,
        },
        experimentKeyRef.current,
        controller.signal,
      );

      onAssistantResult(trimmed, response);
      setLastAnnouncement(
        `${response.message}${response.issues.length > 0 ? ` ${response.issues.join(" ")}` : ""}${response.feedUrl ? " Feed URL ready." : ""}`,
      );
    } catch (requestError) {
      if (controller.signal.aborted && controller.signal.reason !== INTERACTION_TIMEOUT_REASON) {
        return;
      }

      if (controller.signal.reason === INTERACTION_TIMEOUT_REASON) {
        setError(
          "Ask mode took too long to respond. You can retry or continue with the guided builder.",
        );
        return;
      }

      if (requestError instanceof AssistantApiError && requestError.status === 404) {
        onGuidedFallback(true);
        return;
      }

      if (requestError instanceof AssistantApiError && requestError.status === 429) {
        setError(
          `Ask mode has reached a request limit. ${formatRetryDelay(requestError.retryAfterSeconds)}`,
        );
        return;
      }

      setError(
        "Ask mode could not finish that request. You can retry or continue with the guided builder.",
      );
    } finally {
      setSubmitting(false);
      completeCycle(controller);
    }
  };

  const startOver = () => {
    cancelCycle();
    setConversationOpen(true);
    setError(null);
    setLastAnnouncement("Started over with an empty feed.");
    setSubmitting(false);
    onStartOver();
  };

  return (
    <article className="ask-feed" hidden={!active}>
      <header className="ask-feed__intro">
        <div className="ask-feed__intro-copy">
          <hgroup>
            <h2 className="ask-feed__title">Describe, refine, or click</h2>
            <p className="ask-feed__description">
              Ask a question, describe a complete feed, or combine short replies with the controls
              that appear below.
            </p>
          </hgroup>
        </div>
        <button className="btn-secondary ask-feed__reset" onClick={startOver} type="button">
          Start over
        </button>
      </header>

      {transcript.length === 0 ? (
        <p className="ask-feed__empty">
          Try “What feeds can I create?” or name topics and an update frequency in one request.
        </p>
      ) : null}

      {showUi ? (
        <AdaptiveStage
          active={active}
          draft={draft}
          feedUrl={feedUrl}
          issues={issues}
          onActivityChange={onActivityChange}
          onGenerate={onGenerate}
          onGuidedFallback={onGuidedFallback}
          onSourceChange={onSourceChange}
          onTopicsChange={onTopicsChange}
          onTtlChange={onTtlChange}
          state={state}
          ttlSelected={ttlSelected}
        />
      ) : null}

      {transcript.length > 0 ? (
        <details
          className="ask-feed__conversation"
          onToggle={(event) => setConversationOpen(event.currentTarget.open)}
          open={conversationOpen}
        >
          <summary className="ask-feed__conversation-summary">Feed builder conversation</summary>
          <ol aria-label="Feed builder conversation" className="ask-feed__transcript">
            {transcript.map((turn, index) => (
              <li
                className={`ask-feed__turn ask-feed__turn--${turn.role}`}
                key={`${turn.role}-${index}`}
              >
                <span className="ask-feed__turn-label">
                  {turn.role === "user" ? "You" : "OSSReleaseFeed"}
                </span>
                <p>{turn.content}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {error ? (
        <section className="ask-feed__error" role="alert">
          <p>{error}</p>
          <div className="ask-feed__error-actions">
            <button className="btn-secondary" onClick={() => submit()} type="button">
              Retry
            </button>
            <button className="btn-secondary" onClick={() => onGuidedFallback(false)} type="button">
              Continue with Guide me
            </button>
          </div>
        </section>
      ) : null}

      <form aria-labelledby={formLegendId} className="ask-feed__form" onSubmit={submit}>
        <fieldset className="ask-feed__fieldset" disabled={submitting}>
          <legend className="ask-feed__legend" id={formLegendId}>
            {transcript.length > 0 ? "Continue the conversation" : "Ask for a topic feed"}
          </legend>
          <label className="ask-feed__label" htmlFor={inputId}>
            {transcript.length > 0 ? "Your next message" : "Your request"}
          </label>
          <textarea
            aria-describedby={counterId}
            aria-invalid={messageTooLong}
            className="ask-feed__input"
            id={inputId}
            onChange={(event) => {
              onComposerChange(event.target.value);
              setError(null);
            }}
            placeholder="Create a feed for CSS, JavaScript, and TypeScript that updates every 24 hours."
            rows={4}
            value={composer}
          />
          <output
            aria-live="polite"
            className={`ask-feed__counter${messageTooLong ? " ask-feed__counter--exceeded" : ""}`}
            id={counterId}
          >
            {characterFeedback}
          </output>
          <p className="ask-feed__rate-policy">
            Ask requests share a server-side network limit. If it is reached, we’ll tell you when to
            try again.
          </p>
          <div className="ask-feed__actions">
            <button
              className="ask-feed__submit"
              disabled={submitting || !composer.trim()}
              type="submit"
            >
              {submitting ? "Working…" : "Send request"}
            </button>
            <span className="ask-feed__status">
              {submitting ? "Interpreting and validating your request" : ""}
            </span>
          </div>
        </fieldset>
      </form>

      <output aria-atomic="true" aria-live="polite" className="visually-hidden">
        {announcement}
      </output>
    </article>
  );
}
