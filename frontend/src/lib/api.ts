// In local dev VITE_WORKER_URL is unset: requests use relative URLs and the
// Vite dev server proxies /api and /feed to `wrangler dev`. Deployed builds
// (Cloudflare Pages preview and production) bake in the Worker's URL.
const workerBase: string = import.meta.env.VITE_WORKER_URL ?? "";

export type FeaturedTopic = {
  name: string;
  display_name: string | null;
  short_description: string | null;
};

export const apiUrl = (path: string): string => `${workerBase}${path}`;

export async function fetchFeaturedTopics(signal?: AbortSignal): Promise<FeaturedTopic[]> {
  const response = await fetch(apiUrl("/api/topics/featured"), { signal });

  if (!response.ok) {
    throw new Error(`Featured topics request failed with ${response.status}`);
  }

  return (await response.json()) as FeaturedTopic[];
}
