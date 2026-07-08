export type FeedConfig =
  | {
      source: "topics";
      topics: string[];
      topicOperator: "or" | "and";
      activityType: "releases" | "all";
      ttl: number;
      format: "atom";
    }
  | {
      source: "starred";
      username: string;
      repos: string[] | null;
      activityType: "releases" | "all";
      ttl: number;
      format: "atom";
    };

const encoder = new TextEncoder();

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
};

export const encodeFeedConfig = (config: FeedConfig): string => {
  const sorted = sortValue(config);
  const json = JSON.stringify(sorted);
  const base64 = bytesToBase64(encoder.encode(json));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};
