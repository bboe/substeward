import { redis } from '@devvit/web/server';

// Tracks when a user was last verified so we can prompt before re-verifying a
// user who was checked recently. Entries expire after the window, so a missing
// key simply means "not verified recently".
const KEY_PREFIX = 'verification:last:';
const WINDOW_DAYS = 7;
const WINDOW_SECONDS = WINDOW_DAYS * 24 * 60 * 60;

export type VerificationRecord = { at: string; result: 'pass' | 'fail' };

// Usernames are case-insensitive on Reddit; normalize the key.
function key(username: string): string {
  return `${KEY_PREFIX}${username.toLowerCase()}`;
}

// Record a completed verification with a rolling expiry.
export async function recordVerification(
  username: string,
  result: 'pass' | 'fail'
): Promise<void> {
  try {
    const record: VerificationRecord = { at: new Date().toISOString(), result };
    await redis.set(key(username), JSON.stringify(record));
    await redis.expire(key(username), WINDOW_SECONDS);
  } catch (error) {
    // Best-effort: a cache hiccup must not break verification.
    console.error('[verification] failed to record recency cache', error);
  }
}

// Return the most recent verification within the window, or null.
export async function getRecentVerification(
  username: string
): Promise<VerificationRecord | null> {
  const raw = await redis.get(key(username));
  return raw ? (JSON.parse(raw) as VerificationRecord) : null;
}

// Human-friendly relative age for a timestamp (pure).
export function describeAge(atIso: string, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - Date.parse(atIso));
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
