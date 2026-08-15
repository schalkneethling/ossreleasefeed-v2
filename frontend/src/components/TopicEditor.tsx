import { useEffect, useId, useRef, useState } from "react";
import { useDebounce } from "../hooks/useDebounce";
import { INTERACTION_TIMEOUT_REASON, useInteractionCycle } from "../hooks/useInteractionCycle";
import { trackEvent } from "../lib/analytics";
import { validateTopic } from "../lib/api";
import { MAX_TOPICS } from "../lib/constraints";
import { FeaturedTopics } from "./FeaturedTopics";

const DEBOUNCE_MS = 450;
const VALIDATION_TIMEOUT_MS = 10_000;

type CustomStatus = "idle" | "loading" | "valid" | "invalid" | "duplicate" | "error";

type TopicEditorProps = {
  active: boolean;
  selectedTopics: readonly string[];
  onTopicsChange: (topics: string[]) => void;
};

export function TopicEditor({ active, selectedTopics, onTopicsChange }: TopicEditorProps) {
  const customInputRef = useRef<HTMLInputElement>(null);
  const [customInput, setCustomInput] = useState("");
  const [customStatus, setCustomStatus] = useState<CustomStatus>("idle");
  const [validatedName, setValidatedName] = useState<string | null>(null);
  const feedbackId = useId();
  const inputId = useId();
  const debouncedCustom = useDebounce(customInput.trim().toLowerCase(), DEBOUNCE_MS);
  const { beginCycle, cancelCycle, completeCycle } = useInteractionCycle(VALIDATION_TIMEOUT_MS);

  useEffect(() => {
    if (!active) {
      cancelCycle();
      setCustomStatus("idle");
      return;
    }

    if (debouncedCustom !== customInput.trim().toLowerCase()) {
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

    const controller = beginCycle();
    setCustomStatus("loading");
    setValidatedName(null);

    validateTopic(debouncedCustom, controller.signal)
      .then((validation) => {
        if (!validation.exists) {
          trackEvent("Feed generation failed", { errorType: "topic-not-found" });
          setCustomStatus("invalid");
          return;
        }

        setValidatedName(validation.name ?? debouncedCustom);
        setCustomStatus("valid");
      })
      .catch(() => {
        if (!controller.signal.aborted || controller.signal.reason === INTERACTION_TIMEOUT_REASON) {
          trackEvent("Feed generation failed", { errorType: "topic-validation-error" });
          setCustomStatus("error");
        }
      })
      .finally(() => {
        completeCycle(controller);
      });

    return cancelCycle;
  }, [
    active,
    beginCycle,
    cancelCycle,
    completeCycle,
    customInput,
    debouncedCustom,
    selectedTopics,
  ]);

  const toggleTopic = (name: string) => {
    if (selectedTopics.includes(name)) {
      onTopicsChange(selectedTopics.filter((topic) => topic !== name));
      return;
    }

    if (selectedTopics.length >= MAX_TOPICS) {
      return;
    }

    onTopicsChange([...selectedTopics, name]);
  };

  const addCustomTopic = () => {
    if (!validatedName || customStatus !== "valid") {
      return;
    }

    if (selectedTopics.includes(validatedName) || selectedTopics.length >= MAX_TOPICS) {
      return;
    }

    onTopicsChange([...selectedTopics, validatedName]);
    setCustomInput("");
    setCustomStatus("idle");
    setValidatedName(null);
    customInputRef.current?.focus();
  };

  const handleCustomKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomTopic();
    }
  };

  const feedbackMessage = () => {
    if (customStatus === "loading") {
      return `Checking “${debouncedCustom}”…`;
    }

    if (customStatus === "valid") {
      return `“${validatedName ?? debouncedCustom}” is a valid GitHub topic.`;
    }

    if (customStatus === "invalid") {
      return `No GitHub topic found matching “${debouncedCustom}”.`;
    }

    if (customStatus === "duplicate") {
      return `“${debouncedCustom}” is already in your selection.`;
    }

    if (customStatus === "error") {
      return "Could not validate topic. Check your connection and try again.";
    }

    return "";
  };

  const atLimit = selectedTopics.length >= MAX_TOPICS;
  const hasError =
    customStatus === "invalid" || customStatus === "duplicate" || customStatus === "error";

  return (
    <div className="topic-editor">
      <FeaturedTopics active={active} onToggleTopic={toggleTopic} selectedTopics={selectedTopics} />

      <div className="custom-topic">
        <label className="custom-topic__label" htmlFor={inputId}>
          Add a custom topic
        </label>
        <div className="custom-topic__input-row">
          <div className="custom-topic__input-wrapper">
            <input
              aria-describedby={customStatus !== "idle" ? feedbackId : undefined}
              aria-invalid={hasError}
              autoCapitalize="none"
              autoCorrect="off"
              className={[
                "custom-topic__input",
                customStatus === "valid" ? "custom-topic__input--valid" : "",
                hasError ? "custom-topic__input--invalid" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={atLimit}
              id={inputId}
              onChange={(event) => setCustomInput(event.target.value)}
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
        <p
          aria-live="polite"
          className={`custom-topic__feedback${hasError ? " custom-topic__feedback--error" : ""}`}
          id={feedbackId}
        >
          {feedbackMessage()}
        </p>
      </div>

      {selectedTopics.length > 0 ? (
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
    </div>
  );
}
