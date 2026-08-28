import { useMemo, useState } from "react";
import type { Repo } from "../lib/api";
import { MAX_STARRED_REPOS } from "../lib/constraints";
import "../styles/starred-step.css";

const PAGE_SIZE = 25;

type RepoPickerProps = {
  repos: readonly Repo[];
  selectedRepos: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  maxRepos?: number;
};

export function RepoPicker({
  repos,
  selectedRepos,
  onSelectionChange,
  maxRepos = MAX_STARRED_REPOS,
}: RepoPickerProps) {
  const [filter, setFilter] = useState("");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  const orderedRepos = useMemo(
    () =>
      [...repos].sort(
        (left, right) =>
          Number(selectedRepos.has(right.full_name)) - Number(selectedRepos.has(left.full_name)),
      ),
    [repos, selectedRepos],
  );

  const filteredRepos = useMemo(() => {
    if (!filter) {
      return orderedRepos;
    }

    const needle = filter.toLowerCase();

    return orderedRepos.filter((repo) => repo.full_name.toLowerCase().includes(needle));
  }, [orderedRepos, filter]);

  const toggleRepo = (fullName: string) => {
    const next = new Set(selectedRepos);

    if (next.has(fullName)) {
      next.delete(fullName);
    } else if (next.size < maxRepos) {
      next.add(fullName);
    }

    onSelectionChange(next);
  };

  const selectAll = () => {
    const next = new Set(selectedRepos);
    let changed = false;

    for (const repo of filteredRepos) {
      if (next.size >= maxRepos) {
        break;
      }

      if (!next.has(repo.full_name)) {
        next.add(repo.full_name);
        changed = true;
      }
    }

    if (changed) {
      onSelectionChange(next);
    }
  };

  const deselectAll = () => {
    const next = new Set(selectedRepos);
    let changed = false;

    for (const repo of filteredRepos) {
      if (next.delete(repo.full_name)) {
        changed = true;
      }
    }

    if (changed) {
      onSelectionChange(next);
    }
  };

  const visibleRepos = filter ? filteredRepos : filteredRepos.slice(0, displayCount);
  const hasMore = !filter && repos.length > displayCount;
  const atCap = selectedRepos.size >= maxRepos;

  return (
    <div className="repo-list">
      <div className="repo-list__controls">
        <input
          aria-label="Filter repositories"
          className="repo-list__filter"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name…"
          type="search"
          value={filter}
        />
        <button className="btn-secondary repo-list__bulk-btn" onClick={selectAll} type="button">
          Select all
        </button>
        <button className="btn-secondary repo-list__bulk-btn" onClick={deselectAll} type="button">
          Deselect all
        </button>
      </div>

      {atCap ? (
        <p aria-live="polite" className="repo-list__cap-note">
          Selection limit reached — up to {maxRepos} repositories. Deselect one to pick another.
        </p>
      ) : null}

      {repos.length === 0 ? (
        <p className="repo-list__empty">No starred repositories to show.</p>
      ) : visibleRepos.length > 0 ? (
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
          onClick={() => setDisplayCount((count) => count + PAGE_SIZE)}
          type="button"
        >
          Load more ({repos.length - displayCount} remaining)
        </button>
      ) : null}
    </div>
  );
}
