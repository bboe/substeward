import { settings } from '@devvit/web/server';

// Defaults for the contributor-only badge and the removal notice.
const DEFAULT_FLAIR_TEXT = 'Contributors only';
const DEFAULT_FLAIR_BACKGROUND_COLOR = '#0079d3';
const DEFAULT_FLAIR_TEXT_COLOR: 'light' | 'dark' = 'light';
const DEFAULT_REMOVAL_MESSAGE =
  'Your comment was removed because the submission "{title}" is open to ' +
  'approved contributors only. If you would like to participate, ask the ' +
  'moderators about becoming an approved contributor.';

export type ContributorOnlySettings = {
  flairText: string;
  flairBackgroundColor: string;
  flairTextColor: 'light' | 'dark';
  removalMessage: string;
};

function toTrimmedString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return fallback;
}

export async function getContributorOnlySettings(): Promise<ContributorOnlySettings> {
  const flairText = toTrimmedString(
    await settings.get<string>('contributorOnlyFlairText'),
    DEFAULT_FLAIR_TEXT
  );
  const flairBackgroundColor = toTrimmedString(
    await settings.get<string>('contributorOnlyFlairBackgroundColor'),
    DEFAULT_FLAIR_BACKGROUND_COLOR
  );
  const flairTextColorRaw = await settings.get<string>(
    'contributorOnlyFlairTextColor'
  );
  const flairTextColor =
    flairTextColorRaw === 'dark' ? 'dark' : DEFAULT_FLAIR_TEXT_COLOR;
  const removalMessage = toTrimmedString(
    await settings.get<string>('contributorOnlyRemovalMessage'),
    DEFAULT_REMOVAL_MESSAGE
  );

  return { flairText, flairBackgroundColor, flairTextColor, removalMessage };
}
