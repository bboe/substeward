# substeward

A Reddit moderation app built on [Devvit Web](https://developers.reddit.com/). It is a Devvit port of
the [`sbmod`](https://github.com/bboe/sbmod) Python/PRAW bot: it verifies a redditor's history against configurable
thresholds and, when they pass, approves them as a subreddit contributor and records a report.

## Features

- **User Verification**: Given a username (via a subreddit menu form, or a right-click action on a
  comment/post author), gathers the redditor's account info, mod notes, and recent comment history,
  applies configurable thresholds (account/comment age, average karma, no bans/mutes), and approves
  passing users as contributors. Each report is posted to a Mod Discussions conversation that the
  app creates automatically the first time one is needed.
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
│   └── verification/
│       ├── README.md
│       ├── evaluate.ts         # Pure verification rules + report formatting (unit tested)
│       ├── verification.ts     # Low-level Reddit fetch helpers (user/notes/comment pages)
│       ├── run.ts              # Chunked run engine: steps, retries, watchdog
│       ├── report.ts           # Modmail report delivery + moderator alerts
│       ├── process.ts          # Entry points: queue a run, resolve comment/post authors
│       ├── analysis.ts         # Active-users + admin-removed tallies (unit tested)
│       ├── activity.ts         # Redis-backed moderator activity feed
│       ├── settings.ts         # Settings reading + validation
│       ├── username.ts         # Username normalization/validation
│       └── forms.ts            # Verify-user form + submit handler
└── routes/
    ├── forms.ts                # Form submit route handlers
    ├── menu.ts                 # Menu action route handlers
    ├── scheduler.ts            # Verification run-step + watchdog endpoints
    └── settings.ts             # Install setting validation endpoints
```

## Configuration

All behavior is configured via subreddit install settings (in `devvit.json` under
`settings.subreddit`, surfaced in the app's Installation Settings UI). See the
[feature README](src/features/verification/README.md#settings) for the full settings table.

## Commands

- `npm run dev`: Starts development mode with live reload on your test subreddit
- `npm run build`: Builds the app
- `npm test`: Runs lint, type-check, and unit tests
- `npm run deploy`: Uploads a new version of the app to Reddit
- `npm run launch`: Publishes the app for review and public use

## Permissions

- Reddit API access with **moderator** scope (`devvit.json` → `permissions.reddit`).
- `redis` is enabled and used to remember the auto-created report modmail conversation.
