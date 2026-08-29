import { canonicalizeJson } from "../../../shared/canonical-json";

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

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
};

export const encodeFeedConfig = (config: FeedConfig): string => {
  const sorted = canonicalizeJson(config);
  const json = JSON.stringify(sorted);
  const base64 = bytesToBase64(encoder.encode(json));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};
