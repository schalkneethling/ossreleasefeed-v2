import { useFocusOnMount } from "../hooks/useFocusOnMount";

export function StarredStep() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();

  return (
    <section aria-labelledby="starred-step-title" className="builder-step">
      <h2 className="builder-step__title" id="starred-step-title" ref={headingRef} tabIndex={-1}>
        Start from your starred repositories
      </h2>
      <p className="builder-step__hint">
        Enter a GitHub username and we will load the repositories it has starred.
      </p>
    </section>
  );
}
