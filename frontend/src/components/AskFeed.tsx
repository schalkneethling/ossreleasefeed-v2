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
type PostSubmitFocus = "composer" | "result" | null;

type AskFeedProps = {
  active: boolean;
  composer: string;
  draft: FeedDraft;
  feedUrl: string | null;
  issues: string[];
  revision: number;
  showUi: boolean;
  state: AdaptiveState;
  suggestions: string[];
  ttlSelected: boolean;
  transcript: AssistantHistoryTurn[];
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onAssistantResult: (
    userMessage: string,
    response: AssistantTurnResponse,
    baseRevision: number,
  ) => void;
  onComposerChange: (composer: string) => void;
  onGenerate: () => void;
  onGuidedFallback: (disabled: boolean) => void;
  onRepoSelectionChange: (repoSelection: FeedDraft["repoSelection"]) => void;
  onSourceChange: (source: FeedDraft["source"]) => void;
  onStartOver: () => void;
  onTopicsChange: (topics: string[]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
  onTurnSubmitted: () => void;
  onUsernameChange: (username: string) => void;
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
  revision,
  showUi,
  state,
  suggestions,
  ttlSelected,
  transcript,
  onActivityChange,
  onAssistantResult,
  onComposerChange,
  onGenerate,
  onGuidedFallback,
  onRepoSelectionChange,
  onSourceChange,
  onStartOver,
  onTopicsChange,
  onTtlChange,
  onTurnSubmitted,
  onUsernameChange,
}: AskFeedProps) {
  const [conversationOpen, setConversationOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAnnouncement, setLastAnnouncement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();
  const counterId = useId();
  const formLegendId = useId();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const experimentKeyRef = useRef(getExperimentKey());
  const lastAttemptRef = useRef<string | null>(null);
  const postSubmitFocusRef = useRef<PostSubmitFocus>(null);
  const revisionRef = useRef(revision);
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
  const showSuggestions = active && suggestions.length > 0;
  revisionRef.current = revision;

  useEffect(() => {
    if (!active) {
      postSubmitFocusRef.current = null;
      cancelCycle();
    }
  }, [active, cancelCycle]);

  useEffect(() => {
    const focusTarget = postSubmitFocusRef.current;

    if (submitting || !active || focusTarget === null) {
      return;
    }

    postSubmitFocusRef.current = null;

    if (focusTarget === "result") {
      return;
    }

    composerRef.current?.focus();
  }, [active, submitting]);

  /**
   * The single turn path. The composer form, a suggested reply, and Retry all
   * send their text through here, so validation, cancellation, stale-revision
   * handling, and the transcript entry are identical however a message starts.
   */
  const submitMessage = async (message: string) => {
    const trimmed = message.trim();

    if (trimmed.toLowerCase() === "start over") {
      startOver();
      // A suggested reply is removed by the reset, so focus needs a stable home.
      composerRef.current?.focus();
      return;
    }

    lastAttemptRef.current = message;

    if (!trimmed) {
      setError("Enter a request before sending it.");
      return;
    }

    if (message.length > ASSISTANT_MESSAGE_LIMIT) {
      setError(
        `Your request exceeds the ${ASSISTANT_MESSAGE_LIMIT} character limit. Shorten it before trying again.`,
      );
      return;
    }

    const controller = beginCycle();
    const baseRevision = revision;
    postSubmitFocusRef.current = null;
    onTurnSubmitted();
    setSubmitting(true);
    setError(null);
    setLastAnnouncement("");

    try {
      const response = await submitAssistantTurn(
        {
          message: trimmed,
          state,
          draft,
          issues,
          ttlSelected,
        },
        experimentKeyRef.current,
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      if (revisionRef.current !== baseRevision) {
        return;
      }

      onAssistantResult(trimmed, response, baseRevision);
      postSubmitFocusRef.current =
        response.state === "ready" && response.feedUrl !== null ? "result" : "composer";
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
      if (
        !controller.signal.aborted &&
        revisionRef.current === baseRevision &&
        postSubmitFocusRef.current === null
      ) {
        postSubmitFocusRef.current = "composer";
      }
      setSubmitting(false);
      completeCycle(controller);
    }
  };

  const submitComposer = (event: FormEvent) => {
    event.preventDefault();
    void submitMessage(composer);
  };

  const retry = () => {
    void submitMessage(lastAttemptRef.current ?? composer);
  };

  const startOver = () => {
    cancelCycle();
    lastAttemptRef.current = null;
    setConversationOpen(true);
    setError(null);
    setLastAnnouncement("Started over with an empty feed.");
    setSubmitting(false);
    postSubmitFocusRef.current = null;
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
          Try “What feeds can I create?” or name topics, a GitHub username, and an update frequency
          in one request.
        </p>
      ) : null}

      {showUi || (state === "ready" && feedUrl !== null) ? (
        <AdaptiveStage
          active={active}
          draft={draft}
          feedUrl={feedUrl}
          issues={issues}
          onActivityChange={onActivityChange}
          onGenerate={onGenerate}
          onGuidedFallback={onGuidedFallback}
          onRepoSelectionChange={onRepoSelectionChange}
          onSourceChange={onSourceChange}
          onTopicsChange={onTopicsChange}
          onTtlChange={onTtlChange}
          onUsernameChange={onUsernameChange}
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
                {showSuggestions && turn.role === "assistant" && index === transcript.length - 1 ? (
                  <fieldset
                    aria-label="Suggested replies"
                    className="ask-feed__suggestions"
                    disabled={submitting}
                  >
                    {suggestions.map((suggestion) => (
                      <button
                        className="ask-feed__suggestion"
                        key={suggestion}
                        onClick={() => {
                          void submitMessage(suggestion);
                        }}
                        type="button"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </fieldset>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {error ? (
        <section className="ask-feed__error" role="alert">
          <p>{error}</p>
          <div className="ask-feed__error-actions">
            <button className="btn-secondary" onClick={retry} type="button">
              Retry
            </button>
            <button className="btn-secondary" onClick={() => onGuidedFallback(false)} type="button">
              Continue with Guide me
            </button>
          </div>
        </section>
      ) : null}

      <form aria-labelledby={formLegendId} className="ask-feed__form" onSubmit={submitComposer}>
        <fieldset className="ask-feed__fieldset" disabled={submitting}>
          <legend className="ask-feed__legend" id={formLegendId}>
            {transcript.length > 0 ? "Continue the conversation" : "Ask for a feed"}
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
            ref={composerRef}
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
            try again. Messages typed here are processed by an AI service (Cloudflare Workers AI or
            TypeSafe) to interpret your request; conversation history is not sent.
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
