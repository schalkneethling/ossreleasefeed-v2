import { useEffect, useId, useRef, useState } from "react";
import { trackEvent } from "../lib/analytics";
import type { FeedDraft, FeedTtl } from "../lib/assistant";

export const TTL_OPTIONS: ReadonlyArray<{ label: string; value: FeedTtl }> = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "1 week", value: 604800 },
];

const COPY_RESET_MS = 2000;

export function FeedConfigPanel({
  activityType,
  ttl,
  disabled = false,
  onGenerate,
  onActivityChange,
  onTtlChange,
}: {
  activityType: FeedDraft["activityType"];
  ttl: FeedTtl;
  disabled?: boolean;
  onGenerate: () => void;
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
}) {
  const panelId = useId();
  const ttlId = useId();

  return (
    <div className="feed-config">
      <h3 className="feed-config__title">Configure your feed</h3>
      <div className="feed-config__fields">
        <fieldset className="feed-config__fieldset">
          <legend className="feed-config__label">Activity type</legend>
          <div className="feed-config__radio-group">
            <div className="feed-config__radio-option">
              <input
                checked={activityType === "releases"}
                id={`${panelId}-activity-releases`}
                name={`${panelId}-activityType`}
                onChange={() => onActivityChange("releases")}
                type="radio"
                value="releases"
              />
              <label htmlFor={`${panelId}-activity-releases`}>Releases only</label>
            </div>
            <div className="feed-config__radio-option">
              <input
                checked={activityType === "all"}
                id={`${panelId}-activity-all`}
                name={`${panelId}-activityType`}
                onChange={() => onActivityChange("all")}
                type="radio"
                value="all"
              />
              <label htmlFor={`${panelId}-activity-all`}>
                All activity (releases, issues, PRs)
              </label>
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
            onChange={(event) => onTtlChange(Number(event.target.value) as FeedTtl)}
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
        disabled={disabled}
        onClick={onGenerate}
        type="button"
      >
        Generate feed URL
      </button>
    </div>
  );
}

type CopyStatus = "idle" | "success" | "failed";

export function GeneratedFeedUrl({ url }: { url: string }) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimerRef.current), []);

  const copyUrl = () => {
    trackEvent("Copy button clicked");

    const settle = (status: CopyStatus) => {
      clearTimeout(resetTimerRef.current);
      setCopyStatus(status);
      resetTimerRef.current = setTimeout(() => setCopyStatus("idle"), COPY_RESET_MS);
    };

    if (!navigator.clipboard) {
      settle("failed");
      return;
    }

    navigator.clipboard
      .writeText(url)
      .then(() => settle("success"))
      .catch(() => settle("failed"));
  };

  const label =
    copyStatus === "success" ? "Copied!" : copyStatus === "failed" ? "Copy failed" : "Copy URL";

  return (
    <div className="feed-url">
      <p className="feed-url__label">Your feed URL</p>
      <div className="feed-url__row">
        <a className="feed-url__link" href={url} rel="noreferrer" target="_blank">
          {url}
        </a>
        <button
          className={[
            "btn-secondary feed-url__copy",
            copyStatus === "success" ? "feed-url__copy--copied" : "",
            copyStatus === "failed" ? "feed-url__copy--failed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={copyUrl}
          type="button"
        >
          {label}
        </button>
      </div>
    </div>
  );
}
