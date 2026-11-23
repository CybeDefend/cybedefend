export class TokenBucket {
  private state = new Map<string, { tokens: number; updatedAt: number }>();
  constructor(private capacity: number, private refillPerSecond: number) {}
  tryConsume(key: string): boolean {
    const now = Date.now();
    const cur = this.state.get(key) ?? { tokens: this.capacity, updatedAt: now };
    cur.tokens = Math.min(this.capacity, cur.tokens + ((now - cur.updatedAt) / 1000) * this.refillPerSecond);
    cur.updatedAt = now;
    if (cur.tokens >= 1) { cur.tokens -= 1; this.state.set(key, cur); return true; }
    this.state.set(key, cur); return false;
  }
}
