import { describe, expect, it } from "vitest";
import { decodeFeedConfig, encodeFeedConfig } from "../../worker/src/lib/config";
import type { FeedConfig } from "../../worker/src/lib/schemas";

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

  it("rejects malformed tokens", () => {
    const decoded = decodeFeedConfig("%%%");

    expect(decoded._tag).toBe("Left");
  });
});
