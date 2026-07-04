import { Either, Schema } from "effect";
import { FeedConfigSchema, type FeedConfig } from "./schemas";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }

  return value;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

export const encodeFeedConfig = (config: FeedConfig): string => {
  const sorted = sortValue(config);
  const json = JSON.stringify(sorted);
  const base64 = bytesToBase64(encoder.encode(json));

  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

export const decodeFeedConfig = (token: string) => {
  try {
    const normalized = token.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = decoder.decode(base64ToBytes(padded));
    const parsed = JSON.parse(json);

    return Schema.decodeUnknownEither(FeedConfigSchema)(parsed);
  } catch (error) {
    return Either.left(
      error instanceof Error ? error : new Error("Invalid feed configuration encoding"),
    );
  }
};
