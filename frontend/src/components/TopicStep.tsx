import { useEffect, useId, useRef, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { feedUrl, validateTopic } from "../lib/api";
import { encodeFeedConfig } from "../lib/config";
import { MAX_TOPICS } from "../lib/constraints";
import { FeaturedTopics } from "./FeaturedTopics";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import "../styles/feed-config.css";
import "../styles/topic-step.css";

const DEBOUNCE_MS = 450;
const COPY_RESET_MS = 2000;

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "1 week", value: 604800 },
];

type CustomStatus = "idle" | "loading" | "valid" | "invalid" | "duplicate";

export function TopicStep() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const customInputRef = useRef<HTMLInputElement>(null);
  const feedbackId = useId();
  const ttlId = useId();

  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [customStatus, setCustomStatus] = useState<CustomStatus>("idle");
  const [activityType, setActivityType] = useState<"releases" | "all">("releases");
  const [ttl, setTtl] = useState(3600);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const debouncedCustom = useDebounce(customInput.trim(), DEBOUNCE_MS);

  useEffect(() => {
    if (!debouncedCustom) {
      setCustomStatus("idle");
      return;
    }

    if (selectedTopics.includes(debouncedCustom)) {
      setCustomStatus("duplicate");
      return;
    }

    const controller = new AbortController();
    setCustomStatus("loading");

    validateTopic(debouncedCustom, controller.signal)
      .then((valid) => setCustomStatus(valid ? "valid" : "invalid"))
      .catch(() => {
        if (!controller.signal.aborted) setCustomStatus("idle");
      });

    return () => controller.abort();
  }, [debouncedCustom, selectedTopics]);

  // Clear the generated URL whenever the config changes.
  useEffect(() => {
    setGeneratedUrl(null);
  }, [selectedTopics, activityType, ttl]);

  const toggleTopic = (name: string) => {
    setSelectedTopics((current) => {
      if (current.includes(name)) return current.filter((t) => t !== name);
      if (current.length >= MAX_TOPICS) return current;
      return [...current, name];
    });
  };

  const addCustomTopic = () => {
    const slug = customInput.trim();
    if (!slug || customStatus !== "valid") return;
    setSelectedTopics((current) => {
      if (current.includes(slug) || current.length >= MAX_TOPICS) return current;
      return [...current, slug];
    });
    setCustomInput("");
    setCustomStatus("idle");
    customInputRef.current?.focus();
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomTopic();
    }
  };

  const generateFeed = () => {
    const url = feedUrl(
      encodeFeedConfig({
        source: "topics",
        topics: [...selectedTopics],
        topicOperator: "or",
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

  const hasTopics = selectedTopics.length > 0;
  const atLimit = selectedTopics.length >= MAX_TOPICS;

  const feedbackMessage = () => {
    if (customStatus === "loading") return <p className="custom-topic__feedback" id={feedbackId} />;
    if (customStatus === "invalid")
      return (
        <p className="custom-topic__feedback custom-topic__feedback--error" id={feedbackId}>
          No GitHub topic found matching &ldquo;{debouncedCustom}&rdquo;.
        </p>
      );
    if (customStatus === "duplicate")
      return (
        <p className="custom-topic__feedback custom-topic__feedback--error" id={feedbackId}>
          &ldquo;{debouncedCustom}&rdquo; is already in your selection.
        </p>
      );
    return <p className="custom-topic__feedback" id={feedbackId} />;
  };

  return (
    <section aria-labelledby="topic-step-title" className="builder-step">
      <h2 className="builder-step__title" id="topic-step-title" ref={headingRef} tabIndex={-1}>
        Choose your topics
      </h2>
      <p className="builder-step__hint">
        Pick up to five GitHub topics. Your feed will cover releases from the most starred
        repositories in each one.
      </p>

      <FeaturedTopics onToggleTopic={toggleTopic} selectedTopics={selectedTopics} />

      <div className="custom-topic">
        <label className="custom-topic__label" htmlFor="custom-topic-input">
          Add a custom topic
        </label>
        <div className="custom-topic__input-row">
          <div className="custom-topic__input-wrapper">
            <input
              aria-describedby={
                customStatus === "invalid" || customStatus === "duplicate" ? feedbackId : undefined
              }
              autoCapitalize="none"
              autoCorrect="off"
              className={[
                "custom-topic__input",
                customStatus === "valid" ? "custom-topic__input--valid" : "",
                customStatus === "invalid" || customStatus === "duplicate"
                  ? "custom-topic__input--invalid"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={atLimit}
              id="custom-topic-input"
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={handleCustomKeyDown}
              placeholder={atLimit ? "Topic limit reached" : "e.g. web-components"}
              ref={customInputRef}
              spellCheck={false}
              type="text"
              value={customInput}
            />
            {customStatus === "loading" ? (
              <span aria-hidden="true" className="custom-topic__spinner" />
            ) : null}
          </div>
          <button
            className="custom-topic__add"
            disabled={customStatus !== "valid"}
            onClick={addCustomTopic}
            type="button"
          >
            Add topic
          </button>
        </div>
        {feedbackMessage()}
      </div>

      {hasTopics ? (
        <ul aria-label="Selected topics" className="topic-tags">
          {selectedTopics.map((name) => (
            <li key={name}>
              <span className="topic-tag">
                <span className="topic-tag__name">{name}</span>
                <button
                  aria-label={`Remove ${name}`}
                  className="topic-tag__remove"
                  onClick={() => toggleTopic(name)}
                  type="button"
                >
                  <svg aria-hidden="true" height="12" viewBox="0 0 12 12" width="12">
                    <path
                      d="M2 2l8 8M10 2l-8 8"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="1.5"
                    />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {hasTopics ? (
        <div className="feed-config">
          <h3 className="feed-config__title">Configure your feed</h3>
          <div className="feed-config__fields">
            <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
              <legend className="feed-config__label">Activity type</legend>
              <div className="feed-config__radio-group">
                <div className="feed-config__radio-option">
                  <input
                    checked={activityType === "releases"}
                    id="topic-activity-releases"
                    name="topic-activityType"
                    onChange={() => setActivityType("releases")}
                    type="radio"
                    value="releases"
                  />
                  <label htmlFor="topic-activity-releases">Releases only</label>
                </div>
                <div className="feed-config__radio-option">
                  <input
                    checked={activityType === "all"}
                    id="topic-activity-all"
                    name="topic-activityType"
                    onChange={() => setActivityType("all")}
                    type="radio"
                    value="all"
                  />
                  <label htmlFor="topic-activity-all">All activity (releases, issues, PRs)</label>
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

          <button className="feed-config__submit" onClick={generateFeed} type="button">
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
