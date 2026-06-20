// Pure helpers for contributor-only enforcement (unit tested).

// Accounts that should never have their comments removed by enforcement.
export function isBotAccount(username: string): boolean {
  const lower = username.toLowerCase();
  return lower === 'automoderator' || lower === 'reddit';
}

// Fill the removal-notice template. Supported placeholders: {title}, {author},
// {subreddit}. Unknown placeholders are left as-is.
export function renderRemovalMessage(
  template: string,
  vars: { title: string; author: string; subreddit: string }
): string {
  return template
    .replaceAll('{title}', vars.title)
    .replaceAll('{author}', vars.author)
    .replaceAll('{subreddit}', vars.subreddit);
}
