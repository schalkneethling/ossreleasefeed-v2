import { useEffect, useReducer, useRef, useState } from "react";
import { AskFeed } from "./components/AskFeed";
import { Builder } from "./components/Builder";
import { Hero } from "./components/Hero";
import { useInteractionCycle } from "./hooks/useInteractionCycle";
import { fetchExperiments, getExperimentKey } from "./lib/assistant";
import {
  adaptiveWorkspaceReducer,
  clearAdaptiveWorkspace,
  DEFAULT_ADAPTIVE_WORKSPACE,
  loadAdaptiveWorkspace,
  persistAdaptiveWorkspace,
  type InteractionMode,
} from "./lib/adaptive-session";
import { trackEvent } from "./lib/analytics";
import { feedUrl } from "./lib/api";
import { encodeFeedConfig } from "./lib/config";

const FeedMark = () => (
  <svg aria-hidden="true" className="site-header__mark" viewBox="0 0 24 24">
    <path d="M4 4a16 16 0 0 1 16 16h-3A13 13 0 0 0 4 7V4z" fill="currentColor" />
    <path d="M4 10.5A9.5 9.5 0 0 1 13.5 20h-3A6.5 6.5 0 0 0 4 13.5v-3z" fill="currentColor" />
    <circle cx="6" cy="18" fill="currentColor" r="2" />
  </svg>
);

export function App() {
  const [experimentEnabled, setExperimentEnabled] = useState(false);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [workspace, dispatch] = useReducer(adaptiveWorkspaceReducer, DEFAULT_ADAPTIVE_WORKSPACE);
  const experimentKeyRef = useRef(getExperimentKey());
  const restoredRef = useRef(false);
  const workspaceRef = useRef(workspace);
  const { beginCycle, cancelCycle, completeCycle } = useInteractionCycle(10_000);

  workspaceRef.current = workspace;

  useEffect(() => {
    const controller = beginCycle();

    fetchExperiments(experimentKeyRef.current, controller.signal)
      .then(({ adaptiveFeedBuilder }) => {
        if (adaptiveFeedBuilder && !restoredRef.current) {
          if (workspaceRef.current === DEFAULT_ADAPTIVE_WORKSPACE) {
            const restored = loadAdaptiveWorkspace();

            if (restored) {
              dispatch({ type: "restore", workspace: restored });
            }
          }

          restoredRef.current = true;
        }

        setExperimentEnabled(adaptiveFeedBuilder);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setExperimentEnabled(false);
        }
      })
      .finally(() => {
        completeCycle(controller);
      });

    return cancelCycle;
  }, [beginCycle, cancelCycle, completeCycle]);

  useEffect(() => {
    if (experimentEnabled && restoredRef.current) {
      persistAdaptiveWorkspace(workspace);
    }
  }, [experimentEnabled, workspace]);

  const startGuided = () => {
    trackEvent("Feed builder started");
    setFallbackMessage(null);
    dispatch({ type: "start-guided" });
  };

  const chooseMode = (mode: InteractionMode) => {
    setFallbackMessage(null);
    dispatch({ type: "select-mode", mode });
  };

  const fallbackToGuided = (disabled: boolean) => {
    setFallbackMessage(
      disabled
        ? "Ask mode was disabled. Your guided feed builder is ready below."
        : "Continue your request with the guided feed builder.",
    );
    dispatch({ type: "fallback-guided" });

    if (disabled) {
      clearAdaptiveWorkspace();
      setExperimentEnabled(false);
    }
  };

  const generateTopicUrl = () => {
    if (workspace.draft.source !== "topics" || workspace.draft.topics.length === 0) {
      return;
    }

    const token = encodeFeedConfig({
      source: "topics",
      topics: workspace.draft.topics,
      topicOperator: "or",
      activityType: workspace.draft.activityType,
      ttl: workspace.draft.ttl,
      format: "atom",
    });

    dispatch({ type: "set-feed-url", feedUrl: feedUrl(token) });
  };

  const generateFeedUrl = () => {
    const { draft } = workspace;

    if (draft.source === "topics" && draft.topics.length > 0) {
      generateTopicUrl();
      return;
    }

    if (draft.source === "starred" && draft.username !== null && draft.repoSelection !== null) {
      const token = encodeFeedConfig({
        source: "starred",
        username: draft.username,
        repos: draft.repoSelection.kind === "subset" ? draft.repoSelection.repos : null,
        activityType: draft.activityType,
        ttl: draft.ttl,
        format: "atom",
      });

      dispatch({ type: "set-feed-url", feedUrl: feedUrl(token) });
    }
  };

  const startOver = () => {
    clearAdaptiveWorkspace();
    setFallbackMessage(null);
    dispatch({ type: "reset" });
  };

  return (
    <>
      <div className="beta-banner">
        <div className="beta-banner__inner">
          <p className="beta-banner__text">
            Public beta — under heavy load, some feeds may briefly return an error while we're on
            shared infrastructure limits.
          </p>
        </div>
      </div>
      <header className="site-header">
        <div className="site-header__inner">
          <span className="site-header__wordmark">
            <FeedMark />
            OSSReleaseFeed
          </span>
        </div>
      </header>
      <main className="page">
        <Hero
          builderStarted={workspace.builderStarted}
          experimentEnabled={experimentEnabled}
          onCreateFeed={startGuided}
        />
        {experimentEnabled ? (
          <section aria-labelledby="interaction-title" className="adaptive-entry">
            <div className="adaptive-entry__heading-row">
              <div>
                <p className="adaptive-entry__eyebrow">Experimental entry point</p>
                <h2 className="adaptive-entry__title" id="interaction-title">
                  How would you like to begin?
                </h2>
              </div>
              <span className="adaptive-entry__badge">Local / preview</span>
            </div>
            <div aria-label="Feed builder interaction mode" className="adaptive-entry__modes">
              <button
                aria-pressed={workspace.selectedMode === "guided"}
                className="adaptive-entry__mode"
                onClick={() => chooseMode("guided")}
                type="button"
              >
                <span className="adaptive-entry__mode-title">Guide me</span>
                <span className="adaptive-entry__mode-detail">
                  Use the familiar step-by-step builder
                </span>
              </button>
              <button
                aria-pressed={workspace.selectedMode === "ask"}
                className="adaptive-entry__mode"
                onClick={() => chooseMode("ask")}
                type="button"
              >
                <span className="adaptive-entry__mode-title">Ask for a feed</span>
                <span className="adaptive-entry__mode-detail">
                  Describe the feed you want in one request
                </span>
              </button>
            </div>
            {workspace.selectedMode === "guided" && !workspace.builderStarted ? (
              <button className="hero__cta" onClick={startGuided} type="button">
                Create feed
              </button>
            ) : null}
          </section>
        ) : null}
        {fallbackMessage ? <output className="adaptive-fallback">{fallbackMessage}</output> : null}
        {experimentEnabled ? (
          <AskFeed
            active={workspace.selectedMode === "ask"}
            composer={workspace.composer}
            draft={workspace.draft}
            feedUrl={workspace.feedUrl}
            issues={workspace.issues}
            showUi={workspace.showUi}
            onActivityChange={(activityType) => dispatch({ type: "set-activity", activityType })}
            onAssistantResult={(userMessage, response) =>
              dispatch({ type: "assistant-result", userMessage, response })
            }
            onComposerChange={(composer) => dispatch({ type: "set-composer", composer })}
            onGenerate={generateFeedUrl}
            onGuidedFallback={fallbackToGuided}
            onRepoSelectionChange={(repoSelection) =>
              dispatch({ type: "set-repo-selection", repoSelection })
            }
            onSourceChange={(source) => dispatch({ type: "set-source", source })}
            onStartOver={startOver}
            onTopicsChange={(topics) => dispatch({ type: "set-topics", topics })}
            onTtlChange={(ttl) => dispatch({ type: "set-ttl", ttl })}
            onUsernameChange={(username) => dispatch({ type: "set-username", username })}
            state={workspace.adaptiveState}
            transcript={workspace.transcript}
            ttlSelected={workspace.ttlSelected}
          />
        ) : null}
        {workspace.builderStarted ? (
          <div hidden={workspace.selectedMode !== "guided"}>
            <Builder
              active={workspace.selectedMode === "guided"}
              draft={workspace.draft}
              feedUrl={workspace.feedUrl}
              onActivityChange={(activityType) => dispatch({ type: "set-activity", activityType })}
              onGenerateTopicUrl={generateTopicUrl}
              onSourceChange={(source) => dispatch({ type: "set-source", source })}
              onTopicsChange={(topics) => dispatch({ type: "set-topics", topics })}
              onTtlChange={(ttl) => dispatch({ type: "set-ttl", ttl })}
            />
          </div>
        ) : null}
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <p className="site-footer__note">
            Feeds are generated from public GitHub activity. Nothing is stored and no account is
            required.
          </p>
          <a
            className="site-footer__link"
            href="https://github.com/schalkneethling/ossreleasefeed-v2/issues"
            rel="noreferrer"
            target="_blank"
          >
            Report an issue
          </a>
        </div>
      </footer>
    </>
  );
}
