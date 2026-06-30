// A per-key time-window gate shared by command cooldowns and alert throttles.
// Tracks an expiry timestamp per key, evicts a key on access once its window has
// passed, and opportunistically sweeps once the map grows — so it can't leak
// memory the way a get/set-only Map does. `now` is injectable for tests.
const SWEEP_THRESHOLD = 1000;

export class Cooldown {
  private readonly expiry = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  // Number of tracked keys (live + not-yet-swept). Mainly for tests/observability.
  get size(): number {
    return this.expiry.size;
  }

  // Milliseconds left on the key's window; 0 if free. Evicts the key if expired.
  remaining(key: string, now = Date.now()): number {
    const expiresAt = this.expiry.get(key);
    if (expiresAt === undefined) return 0;
    const left = expiresAt - now;
    if (left <= 0) {
      this.expiry.delete(key);
      return 0;
    }
    return left;
  }

  // True if the key is outside its window. Does not start a new window.
  isReady(key: string, now = Date.now()): boolean {
    return this.remaining(key, now) === 0;
  }

  // Starts (or restarts) the key's window.
  start(key: string, now = Date.now()): void {
    if (this.expiry.size >= SWEEP_THRESHOLD) this.sweep(now);
    this.expiry.set(key, now + this.windowMs);
  }

  // Starts the window only if the key is free; returns whether it was claimed.
  claim(key: string, now = Date.now()): boolean {
    if (this.remaining(key, now) > 0) return false;
    this.start(key, now);
    return true;
  }

  // Releases a key's window — e.g. an action that claimed it then failed.
  clear(key: string): void {
    this.expiry.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, expiresAt] of this.expiry) {
      if (expiresAt <= now) this.expiry.delete(key);
    }
  }
}
