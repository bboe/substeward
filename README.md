# SubSteward

A Reddit moderation app that adds optional contributor-only posts: a moderator can restrict an
individual post so that only approved contributors may comment on it, and comments from everyone else
are removed automatically. It also verifies redditors against configurable thresholds and approves
passing accounts as subreddit contributors.

## Features

- **User Verification**: Given a username (via a subreddit menu form, or a right-click action on a
  comment/post author), gathers the redditor's account info, mod notes, and recent comment history,
  applies configurable thresholds (account/comment age, average karma, no bans/mutes), and approves
  passing users as contributors. Each report is posted to a Mod Discussions conversation that the
  app creates automatically the first time one is needed.
- **Contributor-only posts**: A moderator toggles a submission contributor-only — which applies a
  mod-only post-flair template that acts as the marker. A `CommentCreate` trigger then removes
  comments on flaired posts from anyone who isn't an approved contributor (bots are exempt, and the
  OP by default via a setting; moderators are not) and modmails the author the reason. An import
  action adopts an existing flair template for subreddits migrating off an AutoMod rule. See the
  [contributor-only feature README](src/features/contributor-only/README.md).
- **Analysis Utilities**: Moderator menu actions to tally recently active commenters and users with
  Reddit/anti-evil removals, posting the results to Mod Discussions.

See the [verification feature README](src/features/verification/README.md) for full behavior and
configuration.

## Tech Stack

- [Devvit](https://developers.reddit.com/): Reddit's platform for building and deploying apps
- [Vite](https://vite.dev/): Fast build tool
- [Hono](https://hono.dev/): Lightweight web framework for backend logic
- [TypeScript](https://www.typescriptlang.org/): Type-safe development

## Project Structure

```text
src/
├── index.ts                    # Server setup and route mounting
├── features/
│   ├── contributor-only/        # Mark posts contributor-only; remove non-contributor comments
│   │   ├── README.md
│   │   ├── store.ts             # The one Redis key: designated flair-template id
│   │   ├── flair.ts             # Create/apply/clear the mod-only badge
│   │   ├── enforce.ts           # Pure helpers (bot check, message render) — unit tested
│   │   ├── settings.ts          # Contributor-only settings
│   │   └── actions.ts           # Toggle/import handlers + CommentCreate enforcement
│   └── verification/
│       ├── README.md
│       ├── evaluate.ts         # Pure verification rules + report formatting (unit tested)
│       ├── verification.ts     # Low-level Reddit fetch helpers (user/notes/comment pages)
│       ├── run.ts              # Chunked run engine: steps, retries, watchdog
│       ├── report.ts           # Modmail report delivery + moderator alerts
│       ├── cache.ts            # Redis recency cache (re-verify prompt)
│       ├── process.ts          # Pre-checks (skip/confirm) + run queuing
│       ├── forms.ts            # Verify/confirm forms + UI mapping
│       ├── analysis.ts         # Active-users/admin-removed helpers (pure, unit tested)
│       ├── analysis-run.ts     # Chunked background engine for the analysis reports
│       ├── activity.ts         # Redis-backed moderator activity feed
│       ├── settings.ts         # Settings reading + validation
│       └── username.ts         # Username normalization/validation
└── routes/
    ├── forms.ts                # Form submit route handlers
    ├── menu.ts                 # Menu action route handlers
    ├── scheduler.ts            # Verification run-step + watchdog endpoints
    ├── settings.ts             # Install setting validation endpoints
    └── triggers.ts             # Event triggers (CommentCreate enforcement)
```

## Configuration

All behavior is configured via subreddit install settings (in `devvit.json` under
`settings.subreddit`, surfaced in the app's Installation Settings UI). See the
[feature README](src/features/verification/README.md#settings) for the full settings table.

## Commands

- `npm run dev`: Starts development mode with live reload on your test subreddit
- `npm run build`: Builds the app
- `npm test`: Runs lint, type-check, unit tests, and harness tests
- `npm run test:unit`: Pure-logic unit tests (`node:test`)
- `npm run test:harness`: Integration tests against mocked Devvit capabilities (`vitest` + `@devvit/test`)
- `npm run deploy`: Uploads a new version of the app to Reddit
- `npm run launch`: Publishes the app for review and public use

## Testing

Two complementary suites:

- **Unit (`node:test`)** — `*.test.ts`: pure logic (verification rules, report formatting,
  validators, tallies, helpers).
- **Harness (`vitest` + `@devvit/test`)** — `*.devvit.test.ts`: the stateful engine against a mocked
  Redis/Scheduler/Settings with the Reddit API stubbed — covers the chunked run (pass/fail/retry/
  watchdog), the recency cache, and the pre-checks (skip/confirm).

## Permissions

- Reddit API access with **moderator** scope (`devvit.json` → `permissions.reddit`).
- `redis` is enabled and used to remember the auto-created report modmail conversation.
