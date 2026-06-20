# Contributor-only posts

Lets moderators restrict an individual submission so that **only approved
contributors may comment** — replacing the older "set a flair, let AutoMod
enforce it" workflow with the same flair-driven model, owned by the app.

## The flair is the marker

A post is contributor-only **iff it wears the designated mod-only post-flair
template**. There is no per-post database — the post's flair _is_ the state. The
only persisted value is the **designated template id** (one Redis key; Devvit
settings are read-only at runtime, so an app-chosen value can't live there).

Because the template is `modOnly`, only moderators can add or remove it, so the
flair-as-marker model can't be bypassed by users.

## Actions

- **Toggle contributor-only** (post, moderator): applies the designated template
  (creating it with a default label on first use) or removes it.
- **Import contributor-only flair** (subreddit, moderator): pick an existing
  post-flair template to designate as the marker — for subreddits transitioning
  from an AutoModerator flair rule. The chosen template is **forced to mod-only**
  so the marker stays bypass-safe. **Posts already wearing that flair are
  enforced immediately**, with no backfill.

The badge's appearance is **not** a setting — moderators customize the template
directly in the subreddit's post flair settings; edits persist (same id).

## Enforcement

A `CommentCreate` trigger reads the post's flair template id **from the trigger
payload** (`post.linkFlair.templateId`), so posts that don't wear the designated
template short-circuit with **no API calls**. On a contributor-only post a
comment is removed unless its author is exempt:

- a **bot** account (`AutoModerator`, `reddit`),
- an **approved contributor**, or
- the **OP** — when the "exempt the OP" setting is on (default).

Moderators are **not** automatically exempt — a moderator must explicitly be an
approved contributor. Removed comments' authors get the configured reason via
modmail.

## Settings (`Contributor-only —` group)

- removal message (modmail body); placeholders: `{title}`, `{author}`,
  `{subreddit}`
- exempt the OP (boolean, default on)

## Files

- `store.ts` — the one Redis key: the designated flair-template id
- `flair.ts` — create/apply/clear the mod-only badge
- `enforce.ts` — pure helpers (`isBotAccount`, `renderRemovalMessage`), unit
  tested
- `settings.ts` — reads the contributor-only settings
- `actions.ts` — toggle + import handlers and the `CommentCreate` handler
