export class AssistantApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Assistant request failed with ${status}`);
    this.name = "AssistantApiError";
  }
}
