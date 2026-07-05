import { useFocusOnMount } from "../hooks/useFocusOnMount";

export function TopicStep() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();

  return (
    <section aria-labelledby="topic-step-title" className="builder-step">
      <h2 className="builder-step__title" id="topic-step-title" ref={headingRef} tabIndex={-1}>
        Choose your topics
      </h2>
      <p className="builder-step__hint">
        Pick up to five GitHub topics. Your feed will cover releases from the most starred
        repositories in each one.
      </p>
    </section>
  );
}
