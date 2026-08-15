import { useCallback, useEffect, useRef } from "react";

export const INTERACTION_TIMEOUT_REASON = "timeout";
const INTERACTION_CANCELLED_REASON = "cancelled";

type ActiveCycle = {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
  handleAbort: () => void;
};

export const useInteractionCycle = (timeoutMs: number) => {
  const activeCycleRef = useRef<ActiveCycle | null>(null);

  const releaseCycle = useCallback((cycle: ActiveCycle) => {
    clearTimeout(cycle.timeoutId);
    cycle.controller.signal.removeEventListener("abort", cycle.handleAbort);

    if (activeCycleRef.current === cycle) {
      activeCycleRef.current = null;
    }
  }, []);

  const cancelCycle = useCallback(() => {
    const cycle = activeCycleRef.current;

    if (!cycle) {
      return;
    }

    releaseCycle(cycle);
    cycle.controller.abort(INTERACTION_CANCELLED_REASON);
  }, [releaseCycle]);

  const beginCycle = useCallback(() => {
    cancelCycle();

    const controller = new AbortController();
    let cycle: ActiveCycle;
    const handleAbort = () => {
      releaseCycle(cycle);
    };
    const timeoutId = setTimeout(() => {
      controller.abort(INTERACTION_TIMEOUT_REASON);
    }, timeoutMs);

    cycle = { controller, timeoutId, handleAbort };
    activeCycleRef.current = cycle;
    controller.signal.addEventListener("abort", handleAbort, { once: true });

    return controller;
  }, [cancelCycle, releaseCycle, timeoutMs]);

  const completeCycle = useCallback(
    (controller: AbortController) => {
      const cycle = activeCycleRef.current;

      if (!cycle || cycle.controller !== controller) {
        return;
      }

      releaseCycle(cycle);
    },
    [releaseCycle],
  );

  useEffect(() => cancelCycle, [cancelCycle]);

  return { beginCycle, cancelCycle, completeCycle };
};
