import { redis } from '@devvit/web/server';
import { STATIC_KEYS } from './keys.js';

// Redis has no key enumeration (no SCAN/KEYS), so to clean up static keys a
// later version no longer uses, each version records the static keys it uses in
// this index. On upgrade we delete any previously-recorded key that is no longer
// in the current registry, then store the current registry for next time.
const STATIC_KEY_INDEX = 'index:staticKeys';

// One-time deletions for keys removed *before* the static-key index existed
// (they were never recorded, so the reconcile below can't find them).
//
// - analysis:reportConversationId — the analysis reports briefly shared a single
//   Mod Discussions thread whose id lived here; they now create per-report
//   threads.
const LEGACY_KEYS = ['analysis:reportConversationId'];

async function readIndex(): Promise<string[]> {
  const raw = await redis.get(STATIC_KEY_INDEX);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// Delete obsolete Redis keys and refresh the static-key index. Idempotent —
// safe to run on every upgrade.
export async function cleanupLegacyData(): Promise<void> {
  // Explicit one-time legacy deletions (pre-index).
  for (const key of LEGACY_KEYS) {
    await redis.del(key);
  }

  // Reconcile: delete any previously-recorded static key the current version no
  // longer uses, then record the current set.
  const current = new Set(STATIC_KEYS);
  const recorded = await readIndex();
  const obsolete = recorded.filter((key) => !current.has(key));
  for (const key of obsolete) {
    await redis.del(key);
  }
  await redis.set(STATIC_KEY_INDEX, JSON.stringify(STATIC_KEYS));

  console.log(
    `[cleanup] removed ${LEGACY_KEYS.length} legacy + ${obsolete.length} obsolete key(s); indexed ${STATIC_KEYS.length} static key(s)`
  );
}
