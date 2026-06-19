// Normalize a moderator-supplied username, mirroring the prefix stripping in
// sbmod/bot.py (handles "u/name" and "/u/name", trims whitespace).
export function normalizeUsername(raw: string): string {
  let username = raw.trim();
  for (const prefix of ['/u/', 'u/']) {
    if (username.toLowerCase().startsWith(prefix)) {
      username = username.slice(prefix.length);
      break;
    }
  }
  return username.trim();
}

// A valid username is a single token with no embedded whitespace.
export function isValidUsername(username: string): boolean {
  return username.length > 0 && !/\s/.test(username);
}
