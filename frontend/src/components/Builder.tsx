import { useEffect, useRef } from "react";
import { trackEvent } from "../lib/analytics";
import type { FeedDraft, FeedTtl } from "../lib/assistant";
import { ModeSelection, type FeedMode } from "./ModeSelection";
import { StarredStep } from "./StarredStep";
import { TopicStep } from "./TopicStep";
import "../styles/builder.css";

type BuilderProps = {
  active: boolean;
  draft: FeedDraft;
  feedUrl: string | null;
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onGenerateTopicUrl: () => void;
  onGenerateStarredUrl: () => void;
  onRepoSelectionChange: (repoSelection: FeedDraft["repoSelection"]) => void;
  onSourceChange: (source: FeedMode) => void;
  onTopicsChange: (topics: string[]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
  onUsernameChange: (username: string) => void;
};

export function Builder({
  active,
  draft,
  feedUrl,
  onActivityChange,
  onGenerateTopicUrl,
  onGenerateStarredUrl,
  onRepoSelectionChange,
  onSourceChange,
  onTopicsChange,
  onTtlChange,
  onUsernameChange,
}: BuilderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (active && draft.source === null) {
      headingRef.current?.focus();
    }
  }, [active, draft.source]);

  const selectMode = (nextMode: FeedMode) => {
    trackEvent("Feed type selected", { mode: nextMode });
    onSourceChange(nextMode);
  };

  return (
    <>
      <section aria-labelledby="builder-title" className="builder">
        <h2 className="builder__title" id="builder-title" ref={headingRef} tabIndex={-1}>
          How do you want to build your feed?
        </h2>
        <p className="builder__hint">
          Build a feed from GitHub topics, or start from the repositories you have starred.
        </p>
        <ModeSelection mode={draft.source} onSelect={selectMode} />
      </section>
      {draft.source === "topics" ? (
        <TopicStep
          active={active}
          draft={draft}
          feedUrl={feedUrl}
          onActivityChange={onActivityChange}
          onGenerate={onGenerateTopicUrl}
          onTopicsChange={onTopicsChange}
          onTtlChange={onTtlChange}
        />
      ) : null}
      {draft.source === "starred" ? (
        <StarredStep
          active={active}
          draft={draft}
          feedUrl={feedUrl}
          onActivityChange={onActivityChange}
          onGenerate={onGenerateStarredUrl}
          onRepoSelectionChange={onRepoSelectionChange}
          onTtlChange={onTtlChange}
          onUsernameChange={onUsernameChange}
        />
      ) : null}
    </>
  );
}
