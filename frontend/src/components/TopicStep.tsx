import { useEffect, useRef } from "react";
import { trackEvent } from "../lib/analytics";
import type { FeedDraft, FeedTtl } from "../lib/assistant";
import { FeedConfigPanel, GeneratedFeedUrl } from "./FeedConfigPanel";
import { TopicEditor } from "./TopicEditor";
import "../styles/feed-config.css";
import "../styles/topic-step.css";

type TopicStepProps = {
  active: boolean;
  draft: FeedDraft;
  feedUrl: string | null;
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onGenerate: () => void;
  onTopicsChange: (topics: string[]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
};

export function TopicStep({
  active,
  draft,
  feedUrl,
  onActivityChange,
  onGenerate,
  onTopicsChange,
  onTtlChange,
}: TopicStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (active) {
      headingRef.current?.focus();
    }
  }, [active]);

  return (
    <section aria-labelledby="topic-step-title" className="builder-step">
      <h2 className="builder-step__title" id="topic-step-title" ref={headingRef} tabIndex={-1}>
        Choose your topics
      </h2>
      <p className="builder-step__hint">
        Pick up to five GitHub topics. Your feed will cover releases from the most starred
        repositories in each one.
      </p>

      <TopicEditor active={active} onTopicsChange={onTopicsChange} selectedTopics={draft.topics} />

      {draft.topics.length > 0 ? (
        <FeedConfigPanel
          activityType={draft.activityType}
          onActivityChange={onActivityChange}
          onGenerate={() => {
            onGenerate();
            trackEvent("Feed URL generated successfully", { source: "topics" });
          }}
          onTtlChange={onTtlChange}
          ttl={draft.ttl}
        />
      ) : null}

      {feedUrl ? <GeneratedFeedUrl url={feedUrl} /> : null}
    </section>
  );
}
