import { AsyncLocalStorage } from "node:async_hooks";
import { createRequestLogger, type RequestLogger } from "evlog";

export type InteractionLog = RequestLogger<Record<string, unknown>>;

const storage = new AsyncLocalStorage<InteractionLog>();

export async function withInteractionLog<T>(
  context: Record<string, unknown>,
  fn: (log: InteractionLog) => Promise<T>,
): Promise<T> {
  const log = createRequestLogger(context);
  try {
    return await storage.run(log, () => fn(log));
  } finally {
    log.emit();
  }
}

export function useInteractionLog(): InteractionLog | undefined {
  return storage.getStore();
}
