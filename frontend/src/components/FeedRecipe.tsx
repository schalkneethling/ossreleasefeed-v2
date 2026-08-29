import { useEffect, useId, useRef } from "react";
import type { FeedDraft } from "../lib/assistant";
import { TTL_OPTIONS } from "./FeedConfigPanel";

const activityLabels: Record<FeedDraft["activityType"], string> = {
  releases: "Releases only",
  all: "Releases, issues, and pull requests",
};

export function FeedRecipe({ draft }: { draft: FeedDraft }) {
  const titleId = useId();
  const recipeRef = useRef<HTMLElement>(null);
  const ttl = TTL_OPTIONS.find((option) => option.value === draft.ttl)?.label ?? "Unknown";
  let source = "Not selected";

  if (draft.source === "topics") {
    source = "GitHub topics";
  } else if (draft.source === "starred") {
    source = "GitHub starred repositories";
  }

  let match = "Waiting for topics";

  if (draft.source === "topics" && draft.topics.length > 0) {
    match = draft.topics.join(" OR ");
  }

  if (draft.source === "starred") {
    if (draft.repoSelection?.kind === "all") {
      match = "All starred repositories";
    } else if (draft.repoSelection?.kind === "subset") {
      match =
        draft.repoSelection.repos.length === 1
          ? draft.repoSelection.repos[0]
          : `${draft.repoSelection.repos.length} selected repositories`;
    } else {
      match = "Waiting for repositories";
    }
  }

  useEffect(() => {
    const recipe = recipeRef.current;

    if (!recipe) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    recipe.focus({ preventScroll: true });
    recipe.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  return (
    <section
      aria-labelledby={titleId}
      className="feed-recipe"
      data-feed-recipe=""
      ref={recipeRef}
      tabIndex={-1}
    >
      <div className="feed-recipe__heading">
        <p className="feed-recipe__eyebrow">Assembling</p>
        <h3 className="feed-recipe__title" id={titleId}>
          Feed recipe
        </h3>
      </div>
      <dl className="feed-recipe__ledger">
        <div className="feed-recipe__row">
          <dt>Source</dt>
          <dd>{source}</dd>
        </div>
        <div className="feed-recipe__row">
          <dt>Match</dt>
          <dd className="feed-recipe__data">{match}</dd>
        </div>
        <div className="feed-recipe__row">
          <dt>Activity</dt>
          <dd>{activityLabels[draft.activityType]}</dd>
        </div>
        <div className="feed-recipe__row">
          <dt>Refresh</dt>
          <dd>{ttl}</dd>
        </div>
        <div className="feed-recipe__row">
          <dt>Output</dt>
          <dd className="feed-recipe__output">
            <span aria-hidden="true" className="feed-recipe__rss-dot" /> Atom feed
          </dd>
        </div>
      </dl>
    </section>
  );
}
