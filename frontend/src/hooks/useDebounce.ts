import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => setDebounced(value), delayMs);
    const clearTimer = () => {
      clearTimeout(timer);
    };

    controller.signal.addEventListener("abort", clearTimer, { once: true });

    return () => {
      controller.abort();
    };
  }, [value, delayMs]);

  return debounced;
}
