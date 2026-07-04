export const getCache = (): Cache | null => {
  if (typeof caches === "undefined" || !("default" in caches)) {
    return null;
  }

  return caches.default;
};

export const createSnapshotRequest = (request: Request): Request => {
  const url = new URL(request.url);

  url.searchParams.set("__snapshot", "1");

  return new Request(url.toString(), { method: "GET" });
};
