export class KeyedSlidingWindowRateLimiter {
  private readonly entriesByKey = new Map<string, Array<{ readonly timestamp: number; readonly token?: string }>>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("rate limit maximum must be a positive integer");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("rate limit window must be a positive integer");
  }

  take(key: string, nowMs: number, token?: string): boolean {
    const recent = (this.entriesByKey.get(key) ?? []).filter((entry) => nowMs - entry.timestamp < this.windowMs);
    if (token !== undefined && recent.some((entry) => entry.token === token)) {
      this.entriesByKey.set(key, recent);
      return true;
    }
    if (recent.length >= this.maximum) {
      this.entriesByKey.set(key, recent);
      return false;
    }
    recent.push(token === undefined ? { timestamp: nowMs } : { timestamp: nowMs, token });
    this.entriesByKey.set(key, recent);
    return true;
  }

  clear(): void {
    this.entriesByKey.clear();
  }
}
