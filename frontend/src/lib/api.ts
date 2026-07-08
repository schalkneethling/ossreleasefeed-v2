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

export async function validateTopic(slug: string, signal?: AbortSignal): Promise<boolean> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(apiUrl(`/api/topics/validate?q=${encodeURIComponent(slug)}`), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    throw new Error(`Topic validation failed with ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (typeof payload !== "boolean") {
    throw new Error("Topic validation response did not match expected shape");
  }

  return payload;
}

export async function validateUsername(
  username: string,
  signal?: AbortSignal,
): Promise<UsernameValidation> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(apiUrl(`/api/users/validate/${encodeURIComponent(username)}`), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    throw new Error(`Username validation failed with ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!isUsernameValidation(payload)) {
    throw new Error("Username validation response did not match expected shape");
  }

  return payload;
}

export async function fetchStarredRepos(username: string, signal?: AbortSignal): Promise<Repo[]> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(apiUrl(`/api/starred/${encodeURIComponent(username)}`), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    throw new Error(`Starred repos request failed with ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!Array.isArray(payload) || !payload.every(isRepo)) {
    throw new Error("Starred repos response did not match expected shape");
  }

  return payload;
}
