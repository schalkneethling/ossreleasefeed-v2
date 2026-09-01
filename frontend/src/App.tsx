import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AskFeed } from "./components/AskFeed";
import { Builder } from "./components/Builder";
import { Hero } from "./components/Hero";
import { useInteractionCycle } from "./hooks/useInteractionCycle";
import { useWebMcpTools } from "./hooks/useWebMcpTools";
import { fetchExperiments, getExperimentKey } from "./lib/assistant";
import {
  adaptiveWorkspaceReducer,
  clearAdaptiveWorkspace,
  DEFAULT_ADAPTIVE_WORKSPACE,
  loadAdaptiveWorkspace,
  persistAdaptiveWorkspace,
  type AdaptiveAction,
  type InteractionMode,
} from "./lib/adaptive-session";
import { trackEvent } from "./lib/analytics";
import { createFeedUrlForDraft } from "./lib/feed-url";
import { createWebMcpMutationCoordinator, hasWebMcp } from "./lib/webmcp";

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
  const webMcpMutationsRef = useRef(createWebMcpMutationCoordinator());
  const { beginCycle, cancelCycle, completeCycle } = useInteractionCycle(10_000);
  const webMcpAvailable = hasWebMcp();

  workspaceRef.current = workspace;

  const applyWorkspaceAction = useCallback(
    (action: AdaptiveAction, origin: "manual" | "webmcp" = "manual") => {
      if (origin === "manual") {
        webMcpMutationsRef.current.invalidate();
      }

      const next = adaptiveWorkspaceReducer(workspaceRef.current, action);
      workspaceRef.current = next;
      dispatch(action);

      return next;
    },
    [],
  );

  const applyWebMcpAction = useCallback(
    (action: AdaptiveAction) => {
      return applyWorkspaceAction(action, "webmcp");
    },
    [applyWorkspaceAction],
  );

  useWebMcpTools({
    applyAction: applyWebMcpAction,
    mutations: webMcpMutationsRef.current,
    workspace,
  });

  useEffect(() => {
    const controller = beginCycle();

    fetchExperiments(experimentKeyRef.current, controller.signal)
      .then(({ adaptiveFeedBuilder }) => {
        if (adaptiveFeedBuilder && !restoredRef.current) {
          if (workspaceRef.current === DEFAULT_ADAPTIVE_WORKSPACE) {
            const restored = loadAdaptiveWorkspace();

            if (restored) {
              applyWorkspaceAction({ type: "restore", workspace: restored });
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
    applyWorkspaceAction({ type: "start-guided" });
  };

  const chooseMode = (mode: InteractionMode) => {
    setFallbackMessage(null);
    applyWorkspaceAction({ type: "select-mode", mode });
  };

  const fallbackToGuided = (disabled: boolean) => {
    setFallbackMessage(
      disabled
        ? "Ask mode was disabled. Your guided feed builder is ready below."
        : "Continue your request with the guided feed builder.",
    );
    applyWorkspaceAction({ type: "fallback-guided" });

    if (disabled) {
      clearAdaptiveWorkspace();
      setExperimentEnabled(false);
    }
  };

  const generateFeedUrl = () => {
    const generatedUrl = createFeedUrlForDraft(workspace.draft);

    if (generatedUrl !== null) {
      applyWorkspaceAction({ type: "set-feed-url", feedUrl: generatedUrl });
    }
  };

  const startOver = () => {
    clearAdaptiveWorkspace();
    setFallbackMessage(null);
    applyWorkspaceAction({ type: "reset" });
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
      {webMcpAvailable ? (
        <aside aria-label="WebMCP support" className="webmcp-banner">
          <div className="webmcp-banner__inner">
            <p className="webmcp-banner__text">
              WebMCP available — browser agent tools are available on this page.
            </p>
          </div>
        </aside>
      ) : null}
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
            revision={workspace.revision}
            showUi={workspace.showUi}
            onActivityChange={(activityType) =>
              applyWorkspaceAction({ type: "set-activity", activityType })
            }
            onAssistantResult={(userMessage, response, baseRevision) =>
              applyWorkspaceAction({
                type: "assistant-result",
                baseRevision,
                userMessage,
                response,
              })
            }
            onComposerChange={(composer) =>
              applyWorkspaceAction({ type: "set-composer", composer })
            }
            onGenerate={generateFeedUrl}
            onGuidedFallback={fallbackToGuided}
            onRepoSelectionChange={(repoSelection) =>
              applyWorkspaceAction({ type: "set-repo-selection", repoSelection })
            }
            onSourceChange={(source) => applyWorkspaceAction({ type: "set-source", source })}
            onStartOver={startOver}
            onTopicsChange={(topics) => applyWorkspaceAction({ type: "set-topics", topics })}
            onTtlChange={(ttl) => applyWorkspaceAction({ type: "set-ttl", ttl })}
            onUsernameChange={(username) =>
              applyWorkspaceAction({ type: "set-username", username })
            }
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
              onActivityChange={(activityType) =>
                applyWorkspaceAction({ type: "set-activity", activityType })
              }
              onGenerateStarredUrl={generateFeedUrl}
              onGenerateTopicUrl={generateFeedUrl}
              onRepoSelectionChange={(repoSelection) =>
                applyWorkspaceAction({ type: "set-repo-selection", repoSelection })
              }
              onSourceChange={(source) => applyWorkspaceAction({ type: "set-source", source })}
              onTopicsChange={(topics) => applyWorkspaceAction({ type: "set-topics", topics })}
              onTtlChange={(ttl) => applyWorkspaceAction({ type: "set-ttl", ttl })}
              onUsernameChange={(username) =>
                applyWorkspaceAction({ type: "set-username", username })
              }
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
