import { settings } from '@devvit/web/server';

const DEFAULT_REMOVAL_MESSAGE =
  'Your comment was removed because the submission "{title}" is open to ' +
  'approved contributors only. If you would like to participate, ask the ' +
  'moderators about becoming an approved contributor.';

export type ContributorOnlySettings = {
  removalMessage: string;
  // When true, the post author may always comment on their own post.
  exemptOp: boolean;
};

function toTrimmedString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return fallback;
}

export async function getContributorOnlySettings(): Promise<ContributorOnlySettings> {
  const removalMessage = toTrimmedString(
    await settings.get<string>('contributorOnlyRemovalMessage'),
    DEFAULT_REMOVAL_MESSAGE
  );
  // Default on: only an explicit `false` disables the OP exemption.
  const exemptOp =
    (await settings.get<boolean>('contributorOnlyExemptOp')) !== false;

  return { removalMessage, exemptOp };
}
