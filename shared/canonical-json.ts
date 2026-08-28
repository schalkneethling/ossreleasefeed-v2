export const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return [...value].sort().map((item) => canonicalizeJson(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeJson(nested)]),
    );
  }

  return value;
};
