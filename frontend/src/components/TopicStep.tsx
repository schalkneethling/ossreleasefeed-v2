import { useEffect, useId, useRef, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { trackEvent } from "../lib/analytics";
import { feedUrl, validateTopic } from "../lib/api";
import { encodeFeedConfig } from "../lib/config";
import { MAX_TOPICS } from "../lib/constraints";
import { FeaturedTopics } from "./FeaturedTopics";
import { FeedConfigPanel, GeneratedFeedUrl } from "./FeedConfigPanel";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import "../styles/feed-config.css";
import "../styles/topic-step.css";

const DEBOUNCE_MS = 450;

type CustomStatus = "idle" | "loading" | "valid" | "invalid" | "duplicate" | "error";

export function TopicStep() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const customInputRef = useRef<HTMLInputElement>(null);
  const feedbackId = useId();

  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [customStatus, setCustomStatus] = useState<CustomStatus>("idle");
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const debouncedCustom = useDebounce(customInput.trim(), DEBOUNCE_MS);

  useEffect(() => {
    // Skip if the debounce hasn't settled — e.g. immediately after addCustomTopic clears the input
    if (debouncedCustom !== customInput.trim()) {
      setCustomStatus("idle");
      return;
    }

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
      .then((valid) => {
        if (!valid) trackEvent("Feed generation failed", { errorType: "topic-not-found" });
        setCustomStatus(valid ? "valid" : "invalid");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          trackEvent("Feed generation failed", { errorType: "topic-validation-error" });
          setCustomStatus("error");
        }
      });

    return () => controller.abort();
  }, [debouncedCustom, customInput, selectedTopics]);

  // Clear the generated URL whenever the topic selection changes.
  useEffect(() => {
    setGeneratedUrl(null);
  }, [selectedTopics]);

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

  const hasTopics = selectedTopics.length > 0;
  const atLimit = selectedTopics.length >= MAX_TOPICS;

  const feedbackMessage = () => {
    if (customStatus === "loading") return <p className="custom-topic__feedback" id={feedbackId} />;
    if (customStatus === "invalid")
      return (
        <p
          className="custom-topic__feedback custom-topic__feedback--error"
          id={feedbackId}
          role="alert"
        >
          No GitHub topic found matching &ldquo;{debouncedCustom}&rdquo;.
        </p>
      );
    if (customStatus === "duplicate")
      return (
        <p
          className="custom-topic__feedback custom-topic__feedback--error"
          id={feedbackId}
          role="alert"
        >
          &ldquo;{debouncedCustom}&rdquo; is already in your selection.
        </p>
      );
    if (customStatus === "error")
      return (
        <p
          className="custom-topic__feedback custom-topic__feedback--error"
          id={feedbackId}
          role="alert"
        >
          Could not validate topic. Please try again.
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
                customStatus === "invalid" ||
                customStatus === "duplicate" ||
                customStatus === "error"
                  ? feedbackId
                  : undefined
              }
              autoCapitalize="none"
              autoCorrect="off"
              className={[
                "custom-topic__input",
                customStatus === "valid" ? "custom-topic__input--valid" : "",
                customStatus === "invalid" ||
                customStatus === "duplicate" ||
                customStatus === "error"
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
              <span aria-hidden="true" className="spinner custom-topic__spinner" />
            ) : null}
          </div>
          <button
            className="btn-secondary custom-topic__add"
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
        <FeedConfigPanel
          onConfigChange={() => setGeneratedUrl(null)}
          onGenerate={(activityType, ttl) => {
            setGeneratedUrl(
              feedUrl(
                encodeFeedConfig({
                  source: "topics",
                  topics: [...selectedTopics],
                  topicOperator: "or",
                  activityType,
                  ttl,
                  format: "atom",
                }),
              ),
            );
            trackEvent("Feed URL generated successfully", { source: "topics" });
          }}
        />
      ) : null}

      {generatedUrl ? <GeneratedFeedUrl url={generatedUrl} /> : null}
    </section>
  );
}
