// Serializes an unknown thrown value to a log-friendly string, preferring a
// stack trace when one is available.
export function formatError(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
