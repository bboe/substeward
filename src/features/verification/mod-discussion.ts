import { context, reddit } from '@devvit/web/server';

// Shared helper for posting to Mod Discussions. Reddit caps a modmail message
// body at 10000 characters, and creating a conversation with an oversized body
// fails with an unhelpful gRPC error ("struct field 'service'") rather than a
// clear limit message — so any post that could be long is pre-split here.

const MAX_MESSAGE_CHARS = 9000;

// Split a body into messages that each fit the modmail body limit, breaking on
// line boundaries. An overlong single line is hard-split as a last resort; in
// practice report lines are short.
export function chunkBody(body: string, max = MAX_MESSAGE_CHARS): string[] {
  const chunks: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current) chunks.push(current);
    current = '';
  };
  for (const line of body.split('\n')) {
    if (line.length > max) {
      flush();
      for (let i = 0; i < line.length; i += max) {
        chunks.push(line.slice(i, i + max));
      }
      continue;
    }
    if (current && current.length + 1 + line.length > max) flush();
    current = current ? `${current}\n${line}` : line;
  }
  flush();
  return chunks.length > 0 ? chunks : [''];
}

// Post a (possibly long) message as a new Mod Discussions thread. The thread is
// created with the first part as its body; any remaining parts are appended as
// replies, so each message stays under the 10000-char limit.
export async function postModDiscussion(
  subject: string,
  body: string
): Promise<void> {
  const parts = chunkBody(body);
  const messages = parts.map((part, index) =>
    parts.length > 1 ? `(part ${index + 1}/${parts.length})\n\n${part}` : part
  );
  const conversationId = await reddit.modMail.createModDiscussionConversation({
    subject,
    bodyMarkdown: messages[0] as string,
    subredditId: context.subredditId,
  });
  for (let i = 1; i < messages.length; i += 1) {
    await reddit.modMail.reply({
      conversationId,
      body: messages[i] as string,
      isInternal: true,
    });
  }
}
