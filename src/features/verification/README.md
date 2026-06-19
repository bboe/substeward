# User Verification Feature

This feature is a Devvit port of the [`sbmod`](https://github.com/bboe/sbmod) Python bot (built on PRAW). It verifies a
redditor's history against configurable thresholds and, when they pass, approves them as a subreddit
contributor and records a report.

For teams used to PRAW moderation bots, this replaces a hosted inbox-streaming process with native,
event-driven moderator menu actions.

## What It Does

- Given a username, gathers the redditor's account info, mod notes, and recent comment history.
- Verifies them against thresholds (all configurable in subreddit settings):
  - account/oldest-comment age (default: oldest in-subreddit comment must be ≥ 182 days old)
  - minimum average comment karma in the subreddit (default: ≥ 1)
  - no `BAN` or `MUTE` mod notes
  - account is found and not suspended
- On pass: approves the user as a contributor and posts a markdown report.
- On fail: posts a failure report explaining the reason. For failures that occur after comment
  history is gathered (no in-sub history / oldest comment too recent / low karma), the report also
  includes the subreddit-activity summary so moderators see the breakdown.
- Every report is posted as an internal note to an auto-created Mod Discussions thread (see
  "Where the report goes").

### Triggers (how a moderator runs it)

- **Subreddit menu → "Verify a user"** opens a form to type a username.
- **Comment menu → "Verify comment author"** verifies the comment's author directly.
- **Post menu → "Verify post author"** verifies the post's author directly.

Each action **queues a background run** (`scheduler.runJob` → `/internal/scheduler/verify-user`) and
returns immediately with a toast. The actual fetching, evaluation, approval, and report delivery run
in the background, so the moderator is never left waiting on a spinner. The result lands in modmail
(see below).

### Pre-checks (before a run is queued)

Two guards run synchronously when a moderator triggers verification:

- **Already an approved contributor** → verification is **skipped** with a toast (no point re-checking
  someone already approved). Uses a single username-filtered `getApprovedUsers` lookup.
- **Verified within the last 7 days** → a **confirmation form** ("Re-verify user?") is shown with how
  long ago and the prior result; only on confirm is the run queued. Recency is tracked in Redis with a
  rolling 7-day TTL (`verification:last:<username>`); pass and fail results are recorded, approve
  failures are not (so they can be retried without a prompt).

### Chunked execution (why it's a run, not a single job)

Devvit Web enforces a **30-second max request time** per invocation (and there is no setting to
raise it), so pulling up to 1000 comments in one job gets cancelled for long-lived accounts.
Verification is therefore a **multi-step run** driven through the scheduler, with state persisted in
Redis:

1. **init** — look up the account and mod notes; short-circuit to a FAIL report if status/notes fail.
2. **fetch** — pull pages of ~100 comments (using a pagination cursor) until a **soft time budget**
   (~20s, leaving headroom under the 30s limit) or a page cap is hit, then re-enqueue the next step.
   Continues until the last page or Reddit's ~1000-comment history ceiling is reached.
3. **finalize** — run the evaluation rules on the accumulated comments, approve on PASS, and deliver
   the report.

This is Reddit's recommended "daisy-chain" pattern for work that exceeds the request limit: process a
bounded batch, save the cursor, schedule the next batch. The soft time budget adapts automatically to
slow vs. fast accounts instead of relying on a fixed page count. The pure rules in `evaluate.ts` are
unchanged — only the gathering is incremental.

### Reliability (retries, hard failures, watchdog)

- **Per-step retries.** A step that throws a catchable error (transient API/network/rate-limit) is
  retried up to **2 times** (3 attempts total) before giving up.
- **Hard-failure notification.** When retries are exhausted, the run is abandoned and moderators are
  **alerted via a new Mod Discussions conversation** ("⚠️ Verification failed: u/X") and an `error`
  entry in the activity feed — so no one waits on a result that will never come.
- **Watchdog.** Some failures (an execution-time kill) terminate a job _uncatchably_, so the retry
  logic never runs. A cron task (`verificationWatchdog`, every 5 minutes) detects runs that have made
  no progress for over 5 minutes, abandons them, and fires the same moderator alert.

The toast points the moderator at the report thread (Devvit toasts are plain text, so the URL is not
clickable in most clients):

- If a report thread already exists: `Verification started for u/X. Report: https://mod.reddit.com/mail/perma/<id>`
- If none exists yet: `Verification started for u/X. Check your modmail for a new thread.`

### Where the report goes

Reports are posted as internal modmail notes:

1. If this app previously auto-created a report thread, its id is stored in Redis and reused.
2. Otherwise, the **first report creates a new Mod Discussions conversation** ("User verification
   reports") and its id is saved to Redis, so every later report replies to that same thread.

This means reports always have a destination with zero configuration. The active thread's link is
shown at the top of the **"View recent verification activity"** report.

### Observability (seeing what happened)

Three complementary records:

- **Activity feed (moderator-facing)** — recent verification events (queued, pass, fail,
  approve-failed, error) are recorded to a capped Redis sorted set. The subreddit menu action
  **"View recent verification activity"** posts a snapshot of the latest ~25 events to Mod
  Discussions, so moderators can review what the app has been doing without developer tooling. The
  feed is best-effort: a Redis hiccup logs an error but never breaks verification itself.
- **Modmail report thread** — every verification posts its full report (pass or fail) to the report
  thread, so that thread is a human-readable audit trail of decisions and approvals. (Successful
  approvals also appear natively in **Mod Tools → Mod Log**.)
- **App logs (developer-facing)** — the lifecycle is logged with a `[verification]` prefix, viewable
  with `devvit logs` (or the `npm run dev` terminal during playtest). Logged steps include: job
  queued, job start, account found/age, mod-note counts, comments fetched and average karma, the
  PASS/FAIL decision and reason, the approval result, and which conversation the report was delivered
  to (or created). `devvit logs` requires app-owner access, so it is not available to ordinary mods.

To follow a single user in the developer logs, filter, e.g. `devvit logs | grep "u/alice"`.

### Analysis utilities (ported from the sbmod CLI)

- **"List recently active users"** tallies commenters across recent submissions.
- **"List users with admin-removed items"** tallies users with Reddit/anti-evil removals
  (anti-evil removals weighted ×100, generic admin removals ×1).

Both post their results to **Mod Discussions** and are bounded by `analysisSubmissionLimit` /
`analysisModLogLimit` to stay within Devvit request limits.

## File Layout

- `evaluate.ts` — pure verification rules + report formatting (fully unit tested).
- `verification.ts` — low-level Reddit fetch helpers (`fetchUser`, `collectNoteCounts`,
  `fetchCommentPage`) used by the run engine.
- `run.ts` — the chunked run engine: init/fetch/finalize steps, per-step retries, hard-failure
  handling, and the watchdog (pure helpers `shouldStopFetching`/`isStale` are unit tested).
- `report.ts` — modmail delivery, report-conversation resolution/auto-creation, and moderator alerts.
- `cache.ts` — Redis recency cache (7-day TTL) + `describeAge` for the re-verify prompt.
- `process.ts` — pre-checks (approved-contributor skip, recency confirm) and run queuing.
- `forms.ts` — verify/confirm forms and the UI mapping for all entry points.
- `analysis.ts` — active-users and admin-removed tallies (pure helpers unit tested).
- `activity.ts` — Redis-backed moderator activity feed.
- `settings.ts` — reads/validates all verification + analysis settings.
- `username.ts` — username normalization/validation.

The run engine is driven via `src/routes/scheduler.ts` — the `verifyUser` (per-step) and
`verificationWatchdog` (cron) tasks declared in `devvit.json`.

## Settings

Verification has no enable/disable toggle: it only runs when a moderator explicitly invokes one of
the menu actions, so the manual trigger is itself the opt-in.

| Setting                         | Default | Purpose                                                                  |
| ------------------------------- | ------- | ------------------------------------------------------------------------ |
| `verificationOldestCommentDays` | `182`   | Minimum age of the oldest in-subreddit comment (`0` disables the check). |
| `verificationMinKarmaAverage`   | `1`     | Minimum average comment karma.                                           |
| `verificationSubredditsToShow`  | `10`    | Top subreddits listed in the report.                                     |
| `verificationTimezone`          | `UTC`   | Timezone (dropdown) for report dates.                                    |
| `analysisSubmissionLimit`       | `100`   | Submissions scanned for active-users report.                             |
| `analysisModLogLimit`           | `500`   | Mod-log entries scanned for admin-removed report.                        |
