import { reddit } from '@devvit/web/server';
import type { CommentData, ModNoteType } from './evaluate.js';

// Low-level Reddit data-fetch helpers used by the chunked run engine (run.ts).
// Each is intentionally small so a single scheduler-job invocation stays well
// within the platform execution budget.

// Look up an account. A missing/suspended user resolves to { exists: false }.
export async function fetchUser(
  username: string
): Promise<{ exists: boolean; createdAt: Date | undefined }> {
  const user = await reddit.getUserByUsername(username);
  return { exists: Boolean(user), createdAt: user?.createdAt };
}

// True when the user is already an approved contributor of the subreddit.
// Uses the username filter so this is a single, cheap lookup.
export async function isApprovedContributor(
  subredditName: string,
  username: string
): Promise<boolean> {
  const users = await reddit
    .getApprovedUsers({ subredditName, username })
    .all();
  return users.some(
    (user) => user.username.toLowerCase() === username.toLowerCase()
  );
}

// Fetch every mod note for the user and tally counts by note type.
export async function collectNoteCounts(
  subredditName: string,
  username: string
): Promise<Record<ModNoteType, number>> {
  const counts: Record<ModNoteType, number> = {};
  const notes = await reddit
    .getModNotes({ subreddit: subredditName, user: username })
    .all();
  for (const note of notes) {
    counts[note.type] = (counts[note.type] ?? 0) + 1;
  }
  return counts;
}

export type CommentPage = {
  comments: CommentData[];
  // Cursor (comment fullname) to continue from on the next page.
  nextAfter: string | undefined;
  // True when this is the last page (fewer than pageSize results returned).
  done: boolean;
};

// Fetch a single page of the user's most recent comments, starting after the
// given cursor. Keeps each invocation to one Reddit listing request.
export async function fetchCommentPage(
  username: string,
  after: string | undefined,
  pageSize: number
): Promise<CommentPage> {
  const page = await reddit
    .getCommentsByUser({
      username,
      sort: 'new',
      limit: pageSize,
      ...(after ? { after } : {}),
    })
    .all();

  const comments: CommentData[] = page.map((comment) => ({
    createdAt: comment.createdAt,
    score: comment.score,
    subredditName: comment.subredditName,
  }));

  const last = page[page.length - 1];
  return {
    comments,
    nextAfter: last?.id,
    done: page.length < pageSize,
  };
}
