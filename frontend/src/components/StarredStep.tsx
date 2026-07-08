import { useEffect, useId, useMemo, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { feedUrl, fetchStarredRepos, validateUsername, type Repo } from "../lib/api";
import { encodeFeedConfig } from "../lib/config";
import { MAX_STARRED_REPOS } from "../lib/constraints";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import { FeedConfigPanel, GeneratedFeedUrl } from "./FeedConfigPanel";
import "../styles/feed-config.css";
import "../styles/starred-step.css";

const DEBOUNCE_MS = 450;
const PAGE_SIZE = 25;

type UsernameStatus = "idle" | "loading" | "valid" | "not-found" | "no-stars" | "error";

export function StarredStep() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const usernameFeedbackId = useId();

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const debouncedUsername = useDebounce(username.trim(), DEBOUNCE_MS);

  // Validate username and fetch repos on debounced change
  useEffect(() => {
    if (!debouncedUsername) {
      setUsernameStatus("idle");
      setRepos([]);
      setSelectedRepos(new Set());
      setFilter("");
      setDisplayCount(PAGE_SIZE);
      return;
    }

    const controller = new AbortController();
    setUsernameStatus("loading");
    setRepos([]);
    setSelectedRepos(new Set());
    setFilter("");
    setDisplayCount(PAGE_SIZE);
    setGeneratedUrl(null);

    validateUsername(debouncedUsername, controller.signal)
      .then((result) => {
        if (!result.exists) {
          setUsernameStatus("not-found");
          return;
        }
        if (!result.hasStars) {
          setUsernameStatus("no-stars");
          return;
        }
        return fetchStarredRepos(debouncedUsername, controller.signal).then((fetched) => {
          setRepos(fetched);
          setSelectedRepos(new Set(fetched.slice(0, MAX_STARRED_REPOS).map((r) => r.full_name)));
          setDisplayCount(PAGE_SIZE);
          setUsernameStatus("valid");
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setUsernameStatus("error");
      });

    return () => controller.abort();
  }, [debouncedUsername]);

  // Clear generated URL when repo selection changes
  useEffect(() => {
    setGeneratedUrl(null);
  }, [selectedRepos]);

  const filteredRepos = useMemo(
    () =>
      filter
        ? repos.filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()))
        : repos,
    [repos, filter],
  );

  const toggleRepo = (fullName: string) => {
    setSelectedRepos((current) => {
      const next = new Set(current);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else if (next.size < MAX_STARRED_REPOS) {
        next.add(fullName);
      }
      return next;
    });
  };

  // Operate only on filtered repos, leaving selections outside the current filter intact
  const selectAll = () => {
    setSelectedRepos((current) => {
      const next = new Set(current);
      for (const repo of filteredRepos) {
        if (next.size >= MAX_STARRED_REPOS) break;
        next.add(repo.full_name);
      }
      return next;
    });
  };

  const deselectAll = () => {
    setSelectedRepos((current) => {
      const next = new Set(current);
      for (const repo of filteredRepos) {
        next.delete(repo.full_name);
      }
      return next;
    });
  };

  const visibleRepos = filter ? filteredRepos : filteredRepos.slice(0, displayCount);
  const hasMore = !filter && repos.length > displayCount;
  const atCap = selectedRepos.size >= MAX_STARRED_REPOS;

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
        <div className="repo-list">
          <div className="repo-list__controls">
            <input
              aria-label="Filter repositories"
              className="repo-list__filter"
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name…"
              type="search"
              value={filter}
            />
            <button className="btn-secondary repo-list__bulk-btn" onClick={selectAll} type="button">
              Select all
            </button>
            <button
              className="btn-secondary repo-list__bulk-btn"
              onClick={deselectAll}
              type="button"
            >
              Deselect all
            </button>
          </div>

          {atCap ? (
            <p aria-live="polite" className="repo-list__cap-note">
              Selection limit reached — up to {MAX_STARRED_REPOS} repositories. Deselect one to pick
              another.
            </p>
          ) : null}

          {visibleRepos.length > 0 ? (
            <ul aria-label="Starred repositories" className="repo-list__items">
              {visibleRepos.map((repo) => {
                const checked = selectedRepos.has(repo.full_name);
                const disabled = !checked && atCap;
                return (
                  <li className="repo-item" key={repo.full_name}>
                    <label className="repo-item__label">
                      <input
                        checked={checked}
                        className="repo-item__checkbox"
                        disabled={disabled}
                        onChange={() => toggleRepo(repo.full_name)}
                        type="checkbox"
                      />
                      <span className="repo-item__info">
                        <span className="repo-item__name">{repo.full_name}</span>
                        {repo.description ? (
                          <span className="repo-item__description">{repo.description}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="repo-list__empty">No repositories match &ldquo;{filter}&rdquo;.</p>
          )}

          {hasMore ? (
            <button
              className="btn-secondary repo-list__load-more"
              onClick={() => setDisplayCount((c) => c + PAGE_SIZE)}
              type="button"
            >
              Load more ({repos.length - displayCount} remaining)
            </button>
          ) : null}
        </div>
      ) : null}

      {hasRepos ? (
        <FeedConfigPanel
          disabled={selectedRepos.size === 0}
          onConfigChange={() => setGeneratedUrl(null)}
          onGenerate={(activityType, ttl) => {
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
          }}
        />
      ) : null}

      {generatedUrl ? <GeneratedFeedUrl url={generatedUrl} /> : null}
    </section>
  );
}
