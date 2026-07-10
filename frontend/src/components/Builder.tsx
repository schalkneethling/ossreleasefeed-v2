import { useState } from "react";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import { trackEvent } from "../lib/analytics";
import { ModeSelection, type FeedMode } from "./ModeSelection";
import { StarredStep } from "./StarredStep";
import { TopicStep } from "./TopicStep";
import "../styles/builder.css";

export function Builder() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const [mode, setMode] = useState<FeedMode | null>(null);

  const selectMode = (nextMode: FeedMode) => {
    trackEvent("Feed type selected", { mode: nextMode });
    setMode(nextMode);
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
        <ModeSelection mode={mode} onSelect={selectMode} />
      </section>
      {mode === "topics" ? <TopicStep /> : null}
      {mode === "starred" ? <StarredStep /> : null}
    </>
  );
}
