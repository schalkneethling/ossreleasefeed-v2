import { useEffect, useId, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { feedUrl, fetchStarredRepos, validateUsername, type Repo } from "../lib/api";
import { encodeFeedConfig } from "../lib/config";
import { MAX_STARRED_REPOS } from "../lib/constraints";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import "../styles/feed-config.css";
import "../styles/starred-step.css";

const DEBOUNCE_MS = 450;
const COPY_RESET_MS = 2000;
const PAGE_SIZE = 25;

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "1 week", value: 604800 },
];

type UsernameStatus = "idle" | "loading" | "valid" | "not-found" | "no-stars" | "error";

export function StarredStep() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const usernameFeedbackId = useId();
  const ttlId = useId();

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [activityType, setActivityType] = useState<"releases" | "all">("releases");
  const [ttl, setTtl] = useState(3600);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  // Clear generated URL when config changes
  useEffect(() => {
    setGeneratedUrl(null);
  }, [selectedRepos, activityType, ttl]);

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

  const selectAll = () => {
    setSelectedRepos(new Set(filteredRepos.slice(0, MAX_STARRED_REPOS).map((r) => r.full_name)));
  };

  const deselectAll = () => {
    setSelectedRepos(new Set());
  };

  const generateFeed = () => {
    const repoList = [...selectedRepos];
    const url = feedUrl(
      encodeFeedConfig({
        source: "starred",
        username: debouncedUsername,
        repos: repoList.length > 0 ? repoList : null,
        activityType,
        ttl,
        format: "atom",
      }),
    );
    setGeneratedUrl(url);
  };

  const copyUrl = () => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_RESET_MS);
    });
  };

  const filteredRepos = filter
    ? repos.filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()))
    : repos;

  const visibleRepos = filter ? filteredRepos : filteredRepos.slice(0, displayCount);
  const hasMore = !filter && repos.length > displayCount;
  const atCap = selectedRepos.size >= MAX_STARRED_REPOS;

  const usernameFeedback = () => {
    if (usernameStatus === "loading") {
      return (
        <p aria-live="polite" className="username-input__loading">
          <span aria-hidden="true" className="username-input__spinner" />
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
            usernameStatus === "not-found" || usernameStatus === "no-stars"
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
            <button className="repo-list__bulk-btn" onClick={selectAll} type="button">
              Select all
            </button>
            <button className="repo-list__bulk-btn" onClick={deselectAll} type="button">
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
              className="repo-list__load-more"
              onClick={() => setDisplayCount((c) => c + PAGE_SIZE)}
              type="button"
            >
              Load more ({repos.length - displayCount} remaining)
            </button>
          ) : null}
        </div>
      ) : null}

      {hasRepos ? (
        <div className="feed-config">
          <h3 className="feed-config__title">Configure your feed</h3>
          <div className="feed-config__fields">
            <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
              <legend className="feed-config__label">Activity type</legend>
              <div className="feed-config__radio-group">
                <div className="feed-config__radio-option">
                  <input
                    checked={activityType === "releases"}
                    id="starred-activity-releases"
                    name="starred-activityType"
                    onChange={() => setActivityType("releases")}
                    type="radio"
                    value="releases"
                  />
                  <label htmlFor="starred-activity-releases">Releases only</label>
                </div>
                <div className="feed-config__radio-option">
                  <input
                    checked={activityType === "all"}
                    id="starred-activity-all"
                    name="starred-activityType"
                    onChange={() => setActivityType("all")}
                    type="radio"
                    value="all"
                  />
                  <label htmlFor="starred-activity-all">All activity (releases, issues, PRs)</label>
                </div>
              </div>
            </fieldset>

            <div className="feed-config__field">
              <label className="feed-config__label" htmlFor={ttlId}>
                Update frequency
              </label>
              <select
                className="feed-config__select"
                id={ttlId}
                onChange={(e) => setTtl(Number(e.target.value))}
                value={ttl}
              >
                {TTL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="feed-config__submit"
            disabled={selectedRepos.size === 0}
            onClick={generateFeed}
            type="button"
          >
            Generate feed URL
          </button>
        </div>
      ) : null}

      {generatedUrl ? (
        <div className="feed-url">
          <p className="feed-url__label">Your feed URL</p>
          <div className="feed-url__row">
            <a className="feed-url__link" href={generatedUrl} rel="noreferrer" target="_blank">
              {generatedUrl}
            </a>
            <button
              className={`feed-url__copy${copied ? " feed-url__copy--copied" : ""}`}
              onClick={copyUrl}
              type="button"
            >
              {copied ? "Copied!" : "Copy URL"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
