import { useEffect, useState } from "react";
import { fetchFeaturedTopics, type FeaturedTopic } from "../lib/api";
import { MAX_TOPICS } from "../lib/constraints";
import "../styles/featured-topics.css";

type FeaturedTopicsProps = {
  selectedTopics: readonly string[];
  onToggleTopic: (name: string) => void;
};

type FetchStatus =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; topics: FeaturedTopic[] };

export function FeaturedTopics({ selectedTopics, onToggleTopic }: FeaturedTopicsProps) {
  const [status, setStatus] = useState<FetchStatus>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setStatus({ state: "loading" });
    fetchFeaturedTopics(controller.signal)
      .then((topics) => setStatus({ state: "ready", topics }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus({ state: "error" });
        }
      });

    return () => controller.abort();
  }, [attempt]);

  const limitReached = selectedTopics.length >= MAX_TOPICS;

  return (
    <fieldset className="featured-topics">
      <legend className="featured-topics__legend">Featured topics</legend>
      {status.state === "loading" ? (
        <p className="featured-topics__loading" role="status">
          <span aria-hidden="true" className="featured-topics__spinner" />
          Loading featured topics…
        </p>
      ) : null}
      {status.state === "error" ? (
        <div className="featured-topics__error" role="alert">
          <p className="featured-topics__error-message">
            Could not load featured topics. Check your connection and try again.
          </p>
          <button
            className="featured-topics__retry"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}
      {status.state === "ready" ? (
        <ul className="featured-topics__grid">
          {status.topics.map((topic) => {
            const checked = selectedTopics.includes(topic.name);
            const disabled = !checked && limitReached;
            const optionClass = [
              "topic-option",
              checked ? "topic-option--selected" : "",
              disabled ? "topic-option--disabled" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <li key={topic.name}>
                <label className={optionClass}>
                  <input
                    checked={checked}
                    className="topic-option__input"
                    disabled={disabled}
                    onChange={() => onToggleTopic(topic.name)}
                    type="checkbox"
                  />
                  <span className="topic-option__name">{topic.display_name ?? topic.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p aria-live="polite" className="featured-topics__limit">
        {limitReached
          ? `Topic limit reached — you can follow up to ${MAX_TOPICS} topics. Remove one to add a different topic.`
          : ""}
      </p>
    </fieldset>
  );
}
