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

export const feedUrl = (token: string): string => `${workerBase}/feed/${token}`;

export type Repo = {
  full_name: string;
  name: string;
  description: string | null;
  stargazers_count: number;
  owner: { login: string };
};

export type UsernameValidation = {
  exists: boolean;
  username: string | null;
  hasStars: boolean;
};

const isRepo = (value: unknown): value is Repo => {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.full_name === "string" &&
    typeof r.name === "string" &&
    (r.description === null || typeof r.description === "string") &&
    typeof r.stargazers_count === "number" &&
    typeof r.owner === "object" &&
    r.owner !== null &&
    typeof (r.owner as Record<string, unknown>).login === "string"
  );
};

const isUsernameValidation = (value: unknown): value is UsernameValidation => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.exists === "boolean" &&
    (v.username === null || typeof v.username === "string") &&
    typeof v.hasStars === "boolean"
  );
};

async function apiFetch<T>(
  url: string,
  validate: (payload: unknown) => payload is T,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    throw new Error(`${label} request failed with ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!validate(payload)) {
    throw new Error(`${label} response did not match expected shape`);
  }

  return payload;
}

export async function fetchFeaturedTopics(signal?: AbortSignal): Promise<FeaturedTopic[]> {
  return apiFetch(
    apiUrl("/api/topics/featured"),
    (p): p is FeaturedTopic[] => Array.isArray(p) && p.every(isFeaturedTopic),
    "Featured topics",
    signal,
  );
}

export async function validateTopic(slug: string, signal?: AbortSignal): Promise<boolean> {
  return apiFetch(
    apiUrl(`/api/topics/validate?q=${encodeURIComponent(slug)}`),
    (p): p is boolean => typeof p === "boolean",
    "Topic validation",
    signal,
  );
}

export async function validateUsername(
  username: string,
  signal?: AbortSignal,
): Promise<UsernameValidation> {
  return apiFetch(
    apiUrl(`/api/users/validate/${encodeURIComponent(username)}`),
    isUsernameValidation,
    "Username validation",
    signal,
  );
}

export async function fetchStarredRepos(username: string, signal?: AbortSignal): Promise<Repo[]> {
  return apiFetch(
    apiUrl(`/api/starred/${encodeURIComponent(username)}`),
    (p): p is Repo[] => Array.isArray(p) && p.every(isRepo),
    "Starred repos",
    signal,
  );
}
