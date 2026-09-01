import { useEffect, useRef } from "react";
import type { AdaptiveAction, AdaptiveWorkspace } from "../lib/adaptive-session";
import { createWebMcpTools, hasWebMcp, webMcpAvailabilityKey } from "../lib/webmcp";
import { captureWebMcpRegistrationError } from "../lib/sentry";

type WebMcpToolOptions = {
  applyAction: (action: AdaptiveAction) => AdaptiveWorkspace;
  workspace: AdaptiveWorkspace;
};

export const useWebMcpTools = ({ applyAction, workspace }: WebMcpToolOptions): void => {
  const optionsRef = useRef({ applyAction, workspace });
  optionsRef.current = { applyAction, workspace };
  const availabilityKey = webMcpAvailabilityKey(workspace);

  useEffect(() => {
    if (!hasWebMcp()) {
      return;
    }

    const controller = new AbortController();
    const modelContext = document.modelContext;

    if (!modelContext) {
      return;
    }

    const tools = createWebMcpTools({
      applyAction: (action) => {
        const next = optionsRef.current.applyAction(action);
        optionsRef.current = { ...optionsRef.current, workspace: next };

        return next;
      },
      getWorkspace: () => optionsRef.current.workspace,
    });

    tools.forEach((tool) => {
      void modelContext
        .registerTool(tool, { signal: controller.signal })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            captureWebMcpRegistrationError(tool.name, error);
          }
        });
    });

    return () => {
      controller.abort();
    };
  }, [availabilityKey]);
};
