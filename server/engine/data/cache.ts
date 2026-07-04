import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", "..", "..", "data-cache");

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

interface CacheEntry<T> {
  storedAt: string;
  value: T;
}

function keyToPath(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return join(CACHE_DIR, `${h}.json`);
}

// Read-through disk cache with TTL. Returns null on miss/expiry.
export function cacheGet<T>(key: string, ttlMs: number): T | null {
  const p = keyToPath(key);
  if (!existsSync(p)) return null;
  try {
    const entry = JSON.parse(readFileSync(p, "utf8")) as CacheEntry<T>;
    const age = Date.now() - new Date(entry.storedAt).getTime();
    if (age > ttlMs) return null;
    return entry.value;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T): void {
  const entry: CacheEntry<T> = { storedAt: new Date().toISOString(), value };
  try {
    writeFileSync(keyToPath(key), JSON.stringify(entry));
  } catch {
    /* cache write failures are non-fatal */
  }
}

// Wrap a fetch fn with caching. On fetch error, fall back to a stale cache entry
// if one exists (returning it flagged), so a source outage degrades rather than fails.
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<{ value: T; fromCache: boolean; stale: boolean }> {
  const fresh = cacheGet<T>(key, ttlMs);
  if (fresh !== null) return { value: fresh, fromCache: true, stale: false };
  try {
    const value = await fetcher();
    cacheSet(key, value);
    return { value, fromCache: false, stale: false };
  } catch (err) {
    // fall back to any stale copy regardless of TTL
    const p = keyToPath(key);
    if (existsSync(p)) {
      try {
        const entry = JSON.parse(readFileSync(p, "utf8")) as CacheEntry<T>;
        return { value: entry.value, fromCache: true, stale: true };
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

// ---- Market-hours / staleness helpers ----

// Commodity futures don't print on weekends. This is a coarse check: if the most
// recent bar is older than `maxAgeHours` accounting for weekends, flag it stale.
export function isBarStale(lastBarISO: string, nowMs = Date.now()): { stale: boolean; ageHours: number } {
  const ageMs = nowMs - new Date(lastBarISO).getTime();
  const ageHours = ageMs / 36e5;
  const now = new Date(nowMs);
  const dow = now.getUTCDay(); // 0 Sun, 6 Sat
  // On a weekend, a Friday close up to ~72h old is normal, not stale.
  const weekendGrace = dow === 0 || dow === 6 ? 72 : 30;
  return { stale: ageHours > weekendGrace, ageHours };
}
