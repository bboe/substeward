import { redis } from '@devvit/web/server';

// Redis keys written by earlier versions that are no longer used. Deleted on app
// upgrade so they don't linger.
//
// - analysis:reportConversationId — the analysis reports briefly shared a single
//   Mod Discussions thread whose id lived here; they now create a per-report
//   thread, so the key is obsolete.
const LEGACY_KEYS = ['analysis:reportConversationId'];

// Delete obsolete Redis keys. Idempotent — safe to run on every upgrade.
export async function cleanupLegacyData(): Promise<void> {
  for (const key of LEGACY_KEYS) {
    await redis.del(key);
  }
  console.log(`[cleanup] removed ${LEGACY_KEYS.length} legacy key(s)`);
}
