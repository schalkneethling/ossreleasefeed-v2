// In local dev VITE_WORKER_URL is unset: requests use relative URLs and the
// Vite dev server proxies /api and /feed to `wrangler dev`. Deployed builds
// (Cloudflare Pages preview and production) bake in the Worker's URL.
const workerBase: string = import.meta.env.VITE_WORKER_URL ?? "";

const REQUEST_TIMEOUT_MS = 10_000;

export type FeaturedTopic = {
  name: string;
  display_name: string | null;
  short_description: string | null;
};

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isFeaturedTopic = (value: unknown): value is FeaturedTopic => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const topic = value as Record<string, unknown>;

  return (
    typeof topic.name === "string" &&
    isNullableString(topic.display_name) &&
    isNullableString(topic.short_description)
  );
};

export const apiUrl = (path: string): string => `${workerBase}${path}`;

export async function fetchFeaturedTopics(signal?: AbortSignal): Promise<FeaturedTopic[]> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(apiUrl("/api/topics/featured"), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    throw new Error(`Featured topics request failed with ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!Array.isArray(payload) || !payload.every(isFeaturedTopic)) {
    throw new Error("Featured topics response did not match the expected shape");
  }

  return payload;
}
