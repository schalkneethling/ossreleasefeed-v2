import { useEffect, useId, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { trackEvent } from "../lib/analytics";
import { feedUrl, fetchStarredRepos, validateUsername, type Repo } from "../lib/api";
import { encodeFeedConfig } from "../lib/config";
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
  initialUsername?: string;
};

export function StarredStep({ initialUsername = "" }: StarredStepProps) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const usernameFeedbackId = useId();

  const [username, setUsername] = useState(initialUsername);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [activityType, setActivityType] = useState<FeedDraft["activityType"]>("releases");
  const [ttl, setTtl] = useState<FeedTtl>(3600);

  const debouncedUsername = useDebounce(username.trim(), DEBOUNCE_MS);

  // Validate username and fetch repos on debounced change
  useEffect(() => {
    if (!debouncedUsername) {
      setUsernameStatus("idle");
      setRepos([]);
      setSelectedRepos(new Set());
      return;
    }

    const controller = new AbortController();
    setUsernameStatus("loading");
    setRepos([]);
    setSelectedRepos(new Set());
    setGeneratedUrl(null);

    validateUsername(debouncedUsername, controller.signal)
      .then((result) => {
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
            setRepos(fetched);
            setSelectedRepos(new Set(fetched.slice(0, MAX_STARRED_REPOS).map((r) => r.full_name)));
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

    return () => controller.abort();
  }, [debouncedUsername]);

  // Clear generated URL when repo selection changes
  useEffect(() => {
    setGeneratedUrl(null);
  }, [selectedRepos]);

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
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. octocat"
          spellCheck={false}
          type="text"
          value={username}
        />
        {usernameFeedback()}
      </div>

      {hasRepos ? (
        <RepoPicker
          key={debouncedUsername}
          onSelectionChange={setSelectedRepos}
          repos={repos}
          selectedRepos={selectedRepos}
        />
      ) : null}

      {hasRepos ? (
        <FeedConfigPanel
          activityType={activityType}
          disabled={selectedRepos.size === 0}
          onActivityChange={(nextActivityType) => {
            setActivityType(nextActivityType);
            setGeneratedUrl(null);
          }}
          onGenerate={() => {
            const repoList = [...selectedRepos];
            setGeneratedUrl(
              feedUrl(
                encodeFeedConfig({
                  source: "starred",
                  username: debouncedUsername,
                  repos: repoList.length > 0 ? repoList : null,
                  activityType,
                  ttl,
                  format: "atom",
                }),
              ),
            );
            trackEvent("Feed URL generated successfully", { source: "starred" });
          }}
          onTtlChange={(nextTtl) => {
            setTtl(nextTtl);
            setGeneratedUrl(null);
          }}
          ttl={ttl}
        />
      ) : null}

      {generatedUrl ? <GeneratedFeedUrl url={generatedUrl} /> : null}
    </section>
  );
}
