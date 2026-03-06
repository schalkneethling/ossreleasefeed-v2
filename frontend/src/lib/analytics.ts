type UmamiApi = {
  track: (eventName: string, data?: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    umami?: UmamiApi;
  }
}

export function trackEvent(eventName: string, data?: Record<string, unknown>): void {
  window.umami?.track(eventName, data);
}
