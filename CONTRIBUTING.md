# Contributing to SubSteward

Developer documentation for SubSteward. For what the app does and how moderators use it, see the
[README](README.md).

## Tech stack

- [Devvit](https://developers.reddit.com/): Reddit's platform for building and deploying apps
- [Vite](https://vite.dev/): build tool
- [Hono](https://hono.dev/): lightweight web framework for the backend
- [TypeScript](https://www.typescriptlang.org/): type-safe development

## Commands

- `npm run dev` — playtest with live reload on the `substeward_dev` subreddit (`devvit playtest`)
- `npm run build` — build the app (`vite build`)
- `npm test` — lint, type-check, unit tests, and harness tests
- `npm run test:unit` — pure-logic unit tests (`node:test`)
- `npm run test:harness` — integration tests against mocked Devvit capabilities (`vitest` + `@devvit/test`)
- `npm run lint` / `npm run prettier` — lint / format
- `npm run deploy` — run tests, then upload a new version (`devvit upload`)
- `npm run launch` — publish the app for review and public use (`devvit publish`)

Newly added menu items and scheduler tasks require a **fresh `devvit playtest` restart** to register;
hot-reload alone won't pick them up.

## Project structure

```text
src/
├── index.ts                     # Server setup and route mounting
├── features/
│   ├── contributor-only/        # Mark posts contributor-only; remove non-contributor comments
│   │   ├── store.ts             # The one Redis key: designated flair-template id
│   │   ├── flair.ts             # Create/apply/clear the mod-only badge
│   │   ├── enforce.ts           # Pure helpers (bot check, message render) — unit tested
│   │   ├── settings.ts          # Contributor-only settings
│   │   └── actions.ts           # Toggle/import handlers + CommentCreate enforcement
│   └── verification/
│       ├── evaluate.ts          # Pure verification rules + report formatting (unit tested)
│       ├── reddit.ts            # Low-level Reddit fetch helpers (user/notes/comment pages)
│       ├── chunked-run.ts       # Shared daisy-chain run plumbing (store, scheduleStep, ids)
│       ├── verification-run.ts  # Chunked verification engine: steps, retries, watchdog
│       ├── report.ts            # Verification report thread + moderator alerts
│       ├── mod-discussion.ts    # Shared chunked Mod Discussions posting (10k-safe)
│       ├── cache.ts             # Redis recency cache (re-verify prompt)
│       ├── process.ts           # Pre-checks (skip/confirm) + run queuing
│       ├── forms.ts             # Verify/confirm forms + UI mapping
│       ├── analysis.ts          # Active-users/admin-removed helpers (pure, unit tested)
│       ├── analysis-run.ts      # Chunked background engine for the analysis reports
│       ├── cancel.ts            # Kill switch: cancel pending report/verification jobs
│       ├── cleanup.ts           # One-time legacy-Redis-key cleanup (on app upgrade)
│       ├── activity.ts          # Redis-backed moderator activity feed
│       ├── settings.ts          # Settings reading + validation
│       └── username.ts          # Username normalization/validation
└── routes/
    ├── forms.ts                 # Form submit route handlers
    ├── menu.ts                  # Menu action route handlers
    ├── scheduler.ts             # Run-step + watchdog endpoints
    ├── settings.ts             # Install setting validation endpoints
    └── triggers.ts              # Event triggers (CommentCreate enforcement, AppUpgrade cleanup)
```

## Permissions & state

- Reddit API access with **moderator** scope (`devvit.json` → `permissions.reddit`).
- `redis` is enabled. Devvit settings are read-only at runtime, so any app-chosen state lives in
  Redis: the auto-created report modmail conversation id, verification run state and recency cache,
  the moderator activity feed, and the contributor-only designated flair-template id.

## Contributor-only internals

A post is contributor-only **iff it wears the designated mod-only post-flair template** — there is no
per-post database; the post's flair _is_ the state. The only persisted value is the **designated
template id** (one Redis key). Because the template is `modOnly`, users can't add or remove it, so the
marker can't be bypassed.

- **Toggle** applies the designated template (creating it with a default label on first use) or
  removes it.
- **Import** designates an existing post-flair template (for subreddits migrating off an AutoMod flair
  rule), **forcing it to mod-only**. Posts already wearing it are enforced immediately, no backfill.

Enforcement runs in a `CommentCreate` trigger that reads the post's flair template id **from the
trigger payload** (`post.linkFlair.templateId`), so posts that don't wear the designated template
short-circuit with **no API calls**. On a contributor-only post a comment is removed unless its author
is a bot (`AutoModerator`/`reddit`), an approved contributor, or the OP (when the "exempt the OP"
setting is on). Moderators are **not** automatically exempt. Removed authors get the configured reason
via modmail.

## Verification internals

A Devvit port of the [`sbmod`](https://github.com/bboe/sbmod) PRAW bot — replacing a hosted
inbox-streaming process with native, event-driven moderator menu actions.

### Triggers

Each menu action (subreddit "Verify a user" form, comment/post "Verify author") **queues a background
run** (`scheduler.runJob` → `/internal/scheduler/verify-user`) and returns immediately with a toast;
fetching, evaluation, approval, and report delivery all run in the background.

### Pre-checks

Two synchronous guards run before a run is queued:

- **Already an approved contributor** → skipped with a toast (single username-filtered
  `getApprovedUsers` lookup).
- **Verified within the last 7 days** → a "Re-verify user?" confirmation form is shown; only on
  confirm is the run queued. Recency is tracked in Redis with a rolling 7-day TTL
  (`verification:last:<username>`); pass/fail are recorded, approve-failures are not.

### Chunked execution

Devvit Web enforces a **30-second max request time** per invocation, so long histories can't be
pulled in one job. Both verification and the analysis reports use Reddit's recommended
**daisy-chain** pattern: process a bounded batch, persist a cursor in Redis, schedule the next step,
stopping each step at a **soft ~20s time budget** (headroom under the 30s limit). The shared plumbing
— the Redis-backed run store, `scheduleStep` (spaced to respect the 60 `runJob`/min creation limit),
and run-id generation — lives in `chunked-run.ts`.

- **Verification** (`verification-run.ts`): init (account + mod notes) → fetch (pages of ~100 comments until the
  budget/page cap or the ~1000-comment ceiling) → finalize (run `evaluate.ts` rules, approve on PASS,
  deliver report).
- **Analysis** (`analysis-run.ts`): init → scan (recent posts' commenters, or paged mod-log entries)
  → finalize (post the tally to Mod Discussions). Anti-evil removals are weighted ×100, generic admin
  removals ×1.

### Reliability

- **Per-step retries.** A step that throws a catchable error is retried up to 2 times (3 total).
- **Hard-failure notification.** When retries are exhausted, the run is abandoned and moderators are
  alerted via a new Mod Discussions conversation plus an `error` entry in the activity feed.
- **Watchdog.** Some failures (an execution-time kill) terminate a job uncatchably. A cron task
  (`verificationWatchdog`, every 5 minutes) detects runs with no progress for over 5 minutes,
  abandons them, and fires the same alert.

### Where reports go

Reports are posted as internal notes to an auto-created **Mod Discussions** thread: the first report
creates the conversation ("User verification reports") and saves its id to Redis; every later report
replies to that same thread. Zero configuration required.

### Observability

- **Activity feed** — verification events (queued/pass/fail/approve-failed/error) go to a capped Redis
  sorted set; "View recent verification activity" posts a snapshot to Mod Discussions. Best-effort: a
  Redis hiccup logs an error but never breaks verification.
- **Modmail report thread** — every report (pass or fail) is a human-readable audit trail.
- **App logs** — lifecycle logged with a `[verification]` / `[analysis]` prefix, viewable with
  `devvit logs` (owner-only). Follow one user with `devvit logs | grep "u/alice"`.

## Settings

Configured in `devvit.json` under `settings.subreddit`, surfaced in the app's Installation Settings.
Verification has no enable/disable toggle — it only runs on an explicit menu action, so the manual
trigger is the opt-in.

| Setting                         | Default | Purpose                                                                                      |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `contributorOnlyRemovalMessage` | —       | Modmail body sent to removed commenters. Placeholders: `{title}`, `{author}`, `{subreddit}`. |
| `contributorOnlyExemptOp`       | `true`  | When on, a post's author may comment on their own contributor-only post.                     |
| `verificationOldestCommentDays` | `182`   | Minimum age of the oldest in-subreddit comment (`0` disables the check).                     |
| `verificationMinKarmaAverage`   | `1`     | Minimum average comment karma.                                                               |
| `verificationSubredditsToShow`  | `10`    | Top subreddits listed in the report.                                                         |
| `verificationTimezone`          | `UTC`   | Timezone (dropdown) for report dates.                                                        |
| `analysisSubmissionLimit`       | `100`   | Submissions scanned for the recently-active-users report.                                    |
| `analysisModLogLimit`           | `500`   | Mod-log entries scanned for the admin-removed report.                                        |

## Testing

Two complementary suites:

- **Unit (`node:test`)** — `*.test.ts`: pure logic (verification rules, report formatting,
  validators, tallies, helpers).
- **Harness (`vitest` + `@devvit/test`)** — `*.devvit.test.ts`: the stateful engines against mocked
  Redis/Scheduler/Settings with the Reddit API stubbed — covers the chunked runs
  (pass/fail/retry/watchdog), the recency cache, the pre-checks, and contributor-only toggle/import/
  enforcement.

## Pre-commit hooks

This repo uses [pre-commit](https://pre-commit.com/). Install the framework, then `pre-commit install`.
Hooks (see `.pre-commit-config.yaml`): check-added-large-files, check-case-conflict, check-json,
check-merge-conflict, check-yaml, end-of-file-fixer, file-contents-sorter, mixed-line-ending,
trailing-whitespace, plus local eslint (`--fix`), prettier (format + sort JSON keys), and
type-check (`tsc --build`). CI (`.github/workflows/ci.yml`) runs the same hooks and the test suite as
two jobs.
