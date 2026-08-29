import { useEffect, useId, useRef, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { trackEvent } from "../lib/analytics";
import { fetchStarredRepos, validateUsername, type Repo } from "../lib/api";
import { MAX_STARRED_REPOS } from "../lib/constraints";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import type { FeedDraft, FeedTtl } from "../lib/assistant";
import { FeedConfigPanel, GeneratedFeedUrl } from "./FeedConfigPanel";
import { RepoPicker } from "./RepoPicker";
import "../styles/feed-config.css";
import "../styles/starred-step.css";

const DEBOUNCE_MS = 450;

type UsernameStatus = "idle" | "loading" | "valid" | "not-found" | "no-stars" | "error";

type StarredStepProps = {
  active: boolean;
  draft: FeedDraft;
  feedUrl: string | null;
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onGenerate: () => void;
  onRepoSelectionChange: (repoSelection: FeedDraft["repoSelection"]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
  onUsernameChange: (username: string) => void;
};

export function StarredStep({
  active,
  draft,
  feedUrl,
  onActivityChange,
  onGenerate,
  onRepoSelectionChange,
  onTtlChange,
  onUsernameChange,
}: StarredStepProps) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const usernameFeedbackId = useId();

  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [repos, setRepos] = useState<Repo[]>([]);
  const repoSelectionRef = useRef(draft.repoSelection);
  const onRepoSelectionChangeRef = useRef(onRepoSelectionChange);
  const lookupControllerRef = useRef<AbortController | null>(null);
  const username = draft.username ?? "";
  const currentUsernameRef = useRef(username.trim());
  const selectedRepos =
    draft.repoSelection?.kind === "subset"
      ? new Set(draft.repoSelection.repos)
      : draft.repoSelection?.kind === "all"
        ? new Set(repos.slice(0, MAX_STARRED_REPOS).map((repo) => repo.full_name))
        : new Set<string>();

  const debouncedUsername = useDebounce(username.trim(), DEBOUNCE_MS);
  repoSelectionRef.current = draft.repoSelection;
  onRepoSelectionChangeRef.current = onRepoSelectionChange;
  currentUsernameRef.current = username.trim();

  useEffect(() => {
    lookupControllerRef.current?.abort();
    lookupControllerRef.current = null;
    setUsernameStatus("idle");
    setRepos([]);
  }, [active, username]);

  // Validate username and fetch repos on debounced change
  useEffect(() => {
    if (!active || !debouncedUsername) {
      setUsernameStatus("idle");
      setRepos([]);
      return;
    }

    const controller = new AbortController();
    lookupControllerRef.current = controller;
    const isCurrentLookup = () =>
      !controller.signal.aborted && currentUsernameRef.current === debouncedUsername;
    setUsernameStatus("loading");
    setRepos([]);

    validateUsername(debouncedUsername, controller.signal)
      .then((result) => {
        if (!isCurrentLookup()) {
          return;
        }

        if (!result.exists) {
          trackEvent("Feed generation failed", { errorType: "username-not-found" });
          setUsernameStatus("not-found");
          return;
        }
        if (!result.hasStars) {
          trackEvent("Feed generation failed", { errorType: "username-no-stars" });
          setUsernameStatus("no-stars");
          return;
        }
        return fetchStarredRepos(debouncedUsername, controller.signal)
          .then((fetched) => {
            if (!isCurrentLookup()) {
              return;
            }

            if (fetched.length === 0) {
              setUsernameStatus("no-stars");
              return;
            }

            setRepos(fetched);
            if (repoSelectionRef.current === null) {
              onRepoSelectionChangeRef.current({
                kind: "subset",
                repos: fetched.slice(0, MAX_STARRED_REPOS).map((repo) => repo.full_name),
              });
            }
            setUsernameStatus("valid");
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              trackEvent("Feed generation failed", { errorType: "starred-repos-fetch-error" });
              setUsernameStatus("error");
            }
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          trackEvent("Feed generation failed", { errorType: "username-validation-error" });
          setUsernameStatus("error");
        }
      });

    return () => {
      controller.abort();

      if (lookupControllerRef.current === controller) {
        lookupControllerRef.current = null;
      }
    };
  }, [active, debouncedUsername]);

  const usernameFeedback = () => {
    if (usernameStatus === "loading") {
      return (
        <p aria-live="polite" className="username-input__loading">
          <span aria-hidden="true" className="spinner username-input__spinner" />
          Looking up @{debouncedUsername}…
        </p>
      );
    }
    if (usernameStatus === "not-found") {
      return (
        <p
          aria-live="polite"
          className="username-input__feedback username-input__feedback--error"
          id={usernameFeedbackId}
        >
          No GitHub user found with the username &ldquo;{debouncedUsername}&rdquo;.
        </p>
      );
    }
    if (usernameStatus === "no-stars") {
      return (
        <p
          aria-live="polite"
          className="username-input__feedback username-input__feedback--error"
          id={usernameFeedbackId}
        >
          @{debouncedUsername} has no public starred repositories.
        </p>
      );
    }
    if (usernameStatus === "error") {
      return (
        <p
          aria-live="polite"
          className="username-input__feedback username-input__feedback--error"
          id={usernameFeedbackId}
        >
          Could not reach GitHub. Check your connection and try again.
        </p>
      );
    }
    return <p aria-live="polite" className="username-input__feedback" id={usernameFeedbackId} />;
  };

  const hasRepos = usernameStatus === "valid" && repos.length > 0;

  return (
    <section aria-labelledby="starred-step-title" className="builder-step">
      <h2 className="builder-step__title" id="starred-step-title" ref={headingRef} tabIndex={-1}>
        Start from your starred repositories
      </h2>
      <p className="builder-step__hint">
        Enter a GitHub username and we will load the repositories it has starred.
      </p>

      <div className="username-input">
        <label className="username-input__label" htmlFor="github-username">
          GitHub username
        </label>
        <input
          aria-describedby={
            usernameStatus === "not-found" ||
            usernameStatus === "no-stars" ||
            usernameStatus === "error"
              ? usernameFeedbackId
              : undefined
          }
          autoCapitalize="none"
          autoCorrect="off"
          className={[
            "username-input__field",
            usernameStatus === "not-found" || usernameStatus === "no-stars"
              ? "username-input__field--invalid"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          id="github-username"
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="e.g. octocat"
          spellCheck={false}
          type="text"
          value={username}
        />
        {usernameFeedback()}
      </div>

      {hasRepos && draft.repoSelection?.kind === "all" ? (
        <div className="repo-list">
          <p>Including every repository starred by @{debouncedUsername}.</p>
          <button
            className="btn-secondary"
            onClick={() =>
              onRepoSelectionChange({
                kind: "subset",
                repos: repos.slice(0, MAX_STARRED_REPOS).map((repo) => repo.full_name),
              })
            }
            type="button"
          >
            Choose specific repositories
          </button>
        </div>
      ) : hasRepos ? (
        <RepoPicker
          key={debouncedUsername}
          onSelectionChange={(selection) =>
            onRepoSelectionChange(
              selection.size > 0 ? { kind: "subset", repos: [...selection] } : null,
            )
          }
          repos={repos}
          selectedRepos={selectedRepos}
        />
      ) : null}

      {hasRepos && draft.repoSelection?.kind !== "all" ? (
        <div className="repo-list__all-option">
          <p>Prefer every starred repository instead?</p>
          <button
            className="btn-secondary"
            onClick={() => onRepoSelectionChange({ kind: "all" })}
            type="button"
          >
            Include all starred repositories
          </button>
        </div>
      ) : null}

      {hasRepos ? (
        <FeedConfigPanel
          activityType={draft.activityType}
          disabled={selectedRepos.size === 0}
          onActivityChange={onActivityChange}
          onGenerate={() => {
            onGenerate();
            trackEvent("Feed URL generated successfully", { source: "starred" });
          }}
          onTtlChange={onTtlChange}
          ttl={draft.ttl}
        />
      ) : null}

      {feedUrl ? <GeneratedFeedUrl url={feedUrl} /> : null}
    </section>
  );
}
