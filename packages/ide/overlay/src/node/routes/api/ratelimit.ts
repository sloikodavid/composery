import { apiConfig } from "./config"

// In-memory, per-process, reset on restart. Safety rails, not DDoS defense.

class TokenBucket {
  private tokens: number
  private last: number
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst
    this.last = Date.now()
  }
  allow(cost = 1): boolean {
    const now = Date.now()
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate)
    this.last = now
    if (this.tokens >= cost) {
      this.tokens -= cost
      return true
    }
    return false
  }
}

class KeyedRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {}
  allow(key: string): boolean {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = new TokenBucket(this.rate, this.burst)
      this.buckets.set(key, bucket)
    }
    return bucket.allow()
  }
}

// Failed-auth attempts per IP per minute (cheap guessing deterrent).
class FailWindow {
  private readonly hits = new Map<string, number[]>()
  constructor(private readonly perMinute: number) {}
  allow(ip: string): boolean {
    const recent = (this.hits.get(ip) || []).filter((t) => Date.now() - t < 60_000)
    this.hits.set(ip, recent)
    return recent.length < this.perMinute
  }
  record(ip: string): void {
    const recent = this.hits.get(ip) || []
    recent.push(Date.now())
    this.hits.set(ip, recent)
  }
}

// Concurrent interactive/detached sessions per key.
class SessionCounter {
  private readonly counts = new Map<string, number>()
  constructor(private readonly max: number) {}
  tryAcquire(key: string): boolean {
    const current = this.counts.get(key) || 0
    if (current >= this.max) return false
    this.counts.set(key, current + 1)
    return true
  }
  release(key: string): void {
    const current = this.counts.get(key) || 0
    if (current > 0) this.counts.set(key, current - 1)
  }
}

export const rateLimit = new KeyedRateLimiter(apiConfig.rateRps, apiConfig.rateBurst)
export const authFail = new FailWindow(apiConfig.authFailPerMin)
export const sessions = new SessionCounter(apiConfig.maxSessions)
