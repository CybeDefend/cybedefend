import { TokenBucket } from '../token-bucket';
describe('TokenBucket', () => {
  it('allows up to capacity tokens immediately', () => {
    const tb = new TokenBucket(50, 50);
    let allowed = 0; for (let i = 0; i < 100; i++) if (tb.tryConsume('k')) allowed++;
    expect(allowed).toBe(50);
  });
  it('refills at refillPerSecond rate', async () => {
    const tb = new TokenBucket(1, 10);
    expect(tb.tryConsume('k')).toBe(true);
    expect(tb.tryConsume('k')).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect(tb.tryConsume('k')).toBe(true);
  });
  it('isolates buckets per key', () => {
    const tb = new TokenBucket(1, 0);
    expect(tb.tryConsume('a')).toBe(true);
    expect(tb.tryConsume('a')).toBe(false);
    expect(tb.tryConsume('b')).toBe(true);
  });
});
