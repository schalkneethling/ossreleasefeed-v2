import { useEffect, useRef } from "react";

// For sections revealed in response to a user action: move focus to the new
// content's heading so keyboard and screen reader users land on it instead of
// being stranded where the trigger used to be.
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return ref;
}
