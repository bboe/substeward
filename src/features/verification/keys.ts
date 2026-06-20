// Central registry of the app's static (fixed-name) Redis keys.
//
// Listing them in one place lets the upgrade-time cleanup record which static
// keys a version uses (see cleanup.ts): a later version can then delete any
// previously-recorded key it no longer uses, without hand-maintaining a denylist.
//
// Dynamic keys (per-run, per-user, etc.) are intentionally NOT registered here —
// they carry TTLs and expire on their own, and they can't be enumerated anyway.
// Their prefixes live next to the code that owns them.

export const REPORT_CONVERSATION_KEY = 'verification:reportConversationId';
export const ACTIVE_RUNS_KEY = 'verification:runs:active';
export const ACTIVITY_KEY = 'verification:activity';
export const CONTRIBUTOR_ONLY_FLAIR_TEMPLATE_KEY =
  'contributoronly:flairTemplateId';

// Every static key the current version uses. Keep this in sync by importing the
// constants above wherever a static key is read/written, so this stays the
// single source of truth (a key missing here would be treated as obsolete and
// deleted on the next upgrade).
export const STATIC_KEYS: readonly string[] = [
  REPORT_CONVERSATION_KEY,
  ACTIVE_RUNS_KEY,
  ACTIVITY_KEY,
  CONTRIBUTOR_ONLY_FLAIR_TEMPLATE_KEY,
];
