import { describe, expect, it } from "vitest";
import { decodeFeedConfig, encodeFeedConfig } from "../../worker/src/lib/config";
import type { FeedConfig } from "../../worker/src/lib/schemas";
import { encodeRawConfig } from "../helpers";

describe("feed config encoding", () => {
  it("round-trips a valid topic config", () => {
    const config: FeedConfig = {
      source: "topics",
      topics: ["web-components"],
      topicOperator: "or",
      activityType: "releases",
      ttl: 86_400,
      format: "atom",
    };

    const encoded = encodeFeedConfig(config);
    const decoded = decodeFeedConfig(encoded);

    expect(decoded._tag).toBe("Right");
    expect(decoded._tag === "Right" ? decoded.right : null).toEqual(config);
  });

  it("rejects configs below the ttl minimum", () => {
    const encoded = encodeFeedConfig({
      source: "topics",
      topics: ["web-components"],
      topicOperator: "or",
      activityType: "releases",
      ttl: 300,
      format: "atom",
    } as FeedConfig);
    const decoded = decodeFeedConfig(encoded);

    expect(decoded._tag).toBe("Left");
  });

  it("round-trips a valid starred config", () => {
    const config: FeedConfig = {
      source: "starred",
      username: "octocat",
      repos: ["example/repo", "whatwg/html"],
      activityType: "all",
      ttl: 3600,
      format: "json",
    };

    const encoded = encodeFeedConfig(config);
    const decoded = decodeFeedConfig(encoded);

    expect(decoded._tag).toBe("Right");
    expect(decoded._tag === "Right" ? decoded.right : null).toEqual(config);
  });

  it("produces the same token regardless of key order", () => {
    const config: FeedConfig = {
      source: "topics",
      topics: ["web-components"],
      topicOperator: "or",
      activityType: "releases",
      ttl: 86_400,
      format: "atom",
    };
    const shuffled = {
      ttl: 86_400,
      format: "atom",
      topics: ["web-components"],
      activityType: "releases",
      topicOperator: "or",
      source: "topics",
    } as FeedConfig;

    expect(encodeFeedConfig(config)).toBe(encodeFeedConfig(shuffled));
  });

  it("applies defaults for omitted optional fields", () => {
    const decoded = decodeFeedConfig(
      encodeRawConfig({
        source: "topics",
        topics: ["web-components"],
        activityType: "releases",
        ttl: 3600,
      }),
    );

    expect(decoded._tag).toBe("Right");
    expect(decoded._tag === "Right" ? decoded.right : null).toMatchObject({
      topicOperator: "or",
      format: "atom",
    });
  });

  it("rejects configs missing required fields", () => {
    const missingTopics = decodeFeedConfig(
      encodeRawConfig({ source: "topics", activityType: "releases", ttl: 3600 }),
    );
    const missingUsername = decodeFeedConfig(
      encodeRawConfig({ source: "starred", activityType: "releases", ttl: 3600 }),
    );

    expect(missingTopics._tag).toBe("Left");
    expect(missingUsername._tag).toBe("Left");
  });

  it("rejects invalid username patterns", () => {
    const decoded = decodeFeedConfig(
      encodeRawConfig({
        source: "starred",
        username: "bad_name",
        activityType: "releases",
        ttl: 3600,
      }),
    );

    expect(decoded._tag).toBe("Left");
  });

  it("rejects an empty topics list", () => {
    const decoded = decodeFeedConfig(
      encodeRawConfig({ source: "topics", topics: [], activityType: "releases", ttl: 3600 }),
    );

    expect(decoded._tag).toBe("Left");
  });

  it("rejects more than five topics", () => {
    const decoded = decodeFeedConfig(
      encodeRawConfig({
        source: "topics",
        topics: ["one", "two", "three", "four", "five", "six"],
        activityType: "releases",
        ttl: 3600,
      }),
    );

    expect(decoded._tag).toBe("Left");
  });

  it("rejects more than 25 starred repos", () => {
    const decoded = decodeFeedConfig(
      encodeRawConfig({
        source: "starred",
        username: "octocat",
        repos: Array.from({ length: 26 }, (_, index) => `owner/repo-${index}`),
        activityType: "releases",
        ttl: 3600,
      }),
    );

    expect(decoded._tag).toBe("Left");
  });

  it("rejects path traversal attempts inside topic slugs", () => {
    const decoded = decodeFeedConfig(
      encodeRawConfig({
        source: "topics",
        topics: ["../../etc/passwd"],
        activityType: "releases",
        ttl: 3600,
      }),
    );

    expect(decoded._tag).toBe("Left");
  });

  it("rejects malformed tokens", () => {
    const decoded = decodeFeedConfig("%%%");

    expect(decoded._tag).toBe("Left");
  });

  it("rejects tokens that decode to non-JSON", () => {
    const decoded = decodeFeedConfig(Buffer.from("not json at all").toString("base64url"));

    expect(decoded._tag).toBe("Left");
  });

  it("rejects tokens that decode to a non-config JSON value", () => {
    const decoded = decodeFeedConfig(encodeRawConfig(["not", "a", "config"]));

    expect(decoded._tag).toBe("Left");
  });
});
