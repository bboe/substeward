# SubSteward

A Reddit moderation app that adds optional contributor-only posts: a moderator can restrict an
individual post so that only approved contributors may comment on it, and comments from everyone else
are removed automatically. It also verifies redditors against configurable thresholds and approves
passing accounts as subreddit contributors.

## Contributor-only posts

Restrict an individual submission so that **only approved contributors may comment** — a replacement
for the older "set a flair, let AutoMod enforce it" workflow.

- **Toggle contributor-only** — from a post's moderator (`...`) menu. Flips the restriction on or
  off. Under the hood it applies a mod-only post-flair badge that marks the post; toggling again
  removes it.
- **Import contributor-only flair** — from the subreddit's moderator (`...`) menu. If you already
  restrict posts with a flair (e.g. an AutoModerator rule), pick that existing post-flair template
  to adopt as the marker. Posts already wearing it are enforced immediately, and the template is set
  mod-only so only moderators can apply or remove it.

Once a post is contributor-only, any comment is removed unless its author is an **approved
contributor**, a **bot** (`AutoModerator`/`reddit`), or the **OP** (when the "exempt the OP" setting
is on — the default). Moderators are _not_ automatically exempt; add a moderator as an approved
contributor if they should be able to comment. Removed commenters receive the configured reason via
modmail.

To change the badge's label or color, edit the template directly in your subreddit's post-flair
settings.

## User verification

Given a username — via the subreddit's moderator menu form, or from a comment's or post's moderator
(`...`) menu — SubSteward gathers the redditor's account info, mod notes, and recent comment history,
applies your configured thresholds (account/comment age, average karma, no bans/mutes), and approves
passing users as contributors.

Each report is posted to a **Mod Discussions** conversation that the app creates automatically the
first time one is needed, so reports always have a destination with zero setup. That thread doubles
as an audit trail — every verification, pass or fail, is recorded there.

The **View recent verification activity** menu action posts a snapshot of the latest events
(queued, passed, failed, errored) to Mod Discussions, so you can review what the app has been doing
at a glance.

## Analysis utilities

Subreddit menu actions for moderators:

- **List recently active users** — tallies who has commented across recent submissions.
- **List users with admin-removed items** — tallies users whose content was removed by Reddit or
  Anti-Evil Operations.

Both run in the background and post their results to Mod Discussions; you'll get a toast confirming
the report is on its way.

## Settings

All behavior is configured in the app's **Installation Settings** on your subreddit.

### Contributor-only

| Setting         | Default | Purpose                                                                                      |
| --------------- | ------- | -------------------------------------------------------------------------------------------- |
| Removal message | —       | Modmail body sent to removed commenters. Placeholders: `{title}`, `{author}`, `{subreddit}`. |
| Exempt the OP   | On      | When on, the post's author may comment on their own contributor-only post.                   |

### Verification & analysis

| Setting                   | Default | Purpose                                                                  |
| ------------------------- | ------- | ------------------------------------------------------------------------ |
| Oldest comment age (days) | `182`   | Minimum age of the oldest in-subreddit comment (`0` disables the check). |
| Minimum average karma     | `1`     | Minimum average comment karma.                                           |
| Subreddits to show        | `10`    | Top subreddits listed in the report.                                     |
| Timezone                  | `UTC`   | Timezone for report dates.                                               |
| Submissions scanned       | `100`   | Submissions scanned for the recently-active-users report.                |
| Mod-log entries scanned   | `500`   | Mod-log entries scanned for the admin-removed report.                    |

Developers: see [CONTRIBUTING.md](https://github.com/bboe/substeward/blob/main/CONTRIBUTING.md) for
architecture, the full settings keys, and implementation internals.
