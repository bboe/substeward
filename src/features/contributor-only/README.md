# Contributor-only posts

Lets moderators restrict an individual submission so that **only approved
contributors may comment** — replacing the older "set a flair, let AutoMod
enforce it" workflow with a one-click action owned entirely by the app.

## How it works

- **Mark / Unmark** (post moderator menu actions): mark stores the post id in
  Redis and applies a **mod-only** post-flair badge; unmark clears both.
- The flair is created from an app-managed **mod-only flair template** (created
  once, id cached in Redis). `modOnly: true` is what makes the badge uneditable
  by the OP / regular users — only moderators can change it (a platform rule;
  there is no per-post flair lock on Reddit).
- The flair is only a **visible badge**. The Redis flag is the source of truth
  for enforcement, so changing the flair never bypasses the restriction.

## Enforcement

A `CommentCreate` trigger fires on every new comment. Unflagged posts
short-circuit on a single Redis lookup. On a flagged post, a comment is removed
unless its author is exempt:

- a **bot** account (`AutoModerator`, `reddit`),
- an **approved contributor**,
- a **moderator**, or
- the **OP** (post author).

A removed comment's author is sent the configured removal reason via modmail.

## Settings (`Contributor-only —` group)

- flair text, background color, text color (light/dark) for the badge
- removal message (modmail body); placeholders: `{title}`, `{author}`,
  `{subreddit}`

## Files

- `store.ts` — Redis flag + cached flair-template id
- `flair.ts` — create/apply/clear the mod-only badge
- `enforce.ts` — pure helpers (`isBotAccount`, `renderRemovalMessage`), unit
  tested
- `settings.ts` — reads the contributor-only settings
- `actions.ts` — mark/unmark menu handlers + the `CommentCreate` handler
