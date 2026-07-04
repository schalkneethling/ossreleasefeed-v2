import { useEffect, useRef } from "react";
import "../styles/builder.css";

export function Builder() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The section appears in response to the "Create feed" button, so move
  // focus to its heading — keyboard and screen reader users land on the new
  // content instead of being stranded on the button that just disappeared.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="builder-title" className="builder">
      <h2 className="builder__title" id="builder-title" ref={headingRef} tabIndex={-1}>
        How do you want to build your feed?
      </h2>
      <p className="builder__hint">
        Build a feed from GitHub topics, or start from the repositories you have starred.
      </p>
    </section>
  );
}
