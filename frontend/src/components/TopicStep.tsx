import { useState } from "react";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import { MAX_TOPICS } from "../lib/constraints";
import { FeaturedTopics } from "./FeaturedTopics";

export function TopicStep() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>([]);

  const toggleTopic = (name: string) => {
    setSelectedTopics((current) => {
      if (current.includes(name)) {
        return current.filter((topic) => topic !== name);
      }

      if (current.length >= MAX_TOPICS) {
        return current;
      }

      return [...current, name];
    });
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
    </section>
  );
}
