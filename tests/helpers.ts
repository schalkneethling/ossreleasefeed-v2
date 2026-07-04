// Encodes an arbitrary value the same way encodeFeedConfig does, without the
// FeedConfig type constraint — for building deliberately invalid tokens.
export const encodeRawConfig = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
