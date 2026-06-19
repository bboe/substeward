import { settings } from '@devvit/web/server';
import type {
  SettingsValidationRequest,
  SettingsValidationResponse,
} from '@devvit/web/shared';

// Defaults mirror the constants in sbmod/constants.py and verification.py.
const DEFAULT_OLDEST_COMMENT_DAYS = 182;
const DEFAULT_MIN_KARMA_AVERAGE = 1;
const DEFAULT_SUBREDDITS_TO_SHOW = 10;
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_ANALYSIS_SUBMISSION_LIMIT = 100;
const DEFAULT_ANALYSIS_MODLOG_LIMIT = 500;

const MAX_SUBREDDITS_TO_SHOW = 50;

export type VerificationSettings = {
  oldestCommentDays: number;
  minKarmaAverage: number;
  subredditsToShow: number;
  timezone: string;
};

export type AnalysisSettings = {
  submissionLimit: number;
  modLogLimit: number;
};

// Coerce a setting value to a finite number, falling back to a default.
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return undefined;
}

// True when the IANA timezone id is recognized by the runtime.
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function getVerificationSettings(): Promise<VerificationSettings> {
  const oldestCommentDays = toNumber(
    await settings.get<number>('verificationOldestCommentDays'),
    DEFAULT_OLDEST_COMMENT_DAYS
  );
  const minKarmaAverage = toNumber(
    await settings.get<number>('verificationMinKarmaAverage'),
    DEFAULT_MIN_KARMA_AVERAGE
  );
  const subredditsToShow = toNumber(
    await settings.get<number>('verificationSubredditsToShow'),
    DEFAULT_SUBREDDITS_TO_SHOW
  );
  const timezoneSetting = toTrimmedString(
    await settings.get<string>('verificationTimezone')
  );
  const timezone =
    timezoneSetting && isValidTimezone(timezoneSetting)
      ? timezoneSetting
      : DEFAULT_TIMEZONE;

  return {
    oldestCommentDays,
    minKarmaAverage,
    subredditsToShow,
    timezone,
  };
}

export async function getAnalysisSettings(): Promise<AnalysisSettings> {
  const submissionLimit = toNumber(
    await settings.get<number>('analysisSubmissionLimit'),
    DEFAULT_ANALYSIS_SUBMISSION_LIMIT
  );
  const modLogLimit = toNumber(
    await settings.get<number>('analysisModLogLimit'),
    DEFAULT_ANALYSIS_MODLOG_LIMIT
  );
  return { submissionLimit, modLogLimit };
}

// ---- Validators (referenced from devvit.json setting definitions) ----

// Validate a setting that must be a positive integer within an optional max.
function validatePositiveInteger(
  request: SettingsValidationRequest<number>,
  label: string,
  max?: number
): SettingsValidationResponse {
  const value = request.value;
  // Empty is allowed: runtime falls back to the default.
  if (value === undefined || value === null) return { success: true };
  if (!Number.isInteger(value) || value < 1) {
    return {
      success: false,
      error: `${label} must be a positive whole number.`,
    };
  }
  if (max !== undefined && value > max) {
    return { success: false, error: `${label} must be ${max} or fewer.` };
  }
  return { success: true };
}

export function validateOldestCommentDays(
  request: SettingsValidationRequest<number>
): SettingsValidationResponse {
  const value = request.value;
  // Empty falls back to the default at runtime.
  if (value === undefined || value === null) return { success: true };
  // 0 is allowed and means "no minimum age requirement".
  if (!Number.isInteger(value) || value < 0) {
    return {
      success: false,
      error: 'Oldest comment age (days) must be a whole number (0 or more).',
    };
  }
  return { success: true };
}

export function validateMinKarmaAverage(
  request: SettingsValidationRequest<number>
): SettingsValidationResponse {
  const value = request.value;
  if (value === undefined || value === null) return { success: true };
  if (!Number.isFinite(value)) {
    return { success: false, error: 'Minimum karma average must be a number.' };
  }
  return { success: true };
}

export function validateSubredditsToShow(
  request: SettingsValidationRequest<number>
): SettingsValidationResponse {
  return validatePositiveInteger(
    request,
    'Top subreddits to show',
    MAX_SUBREDDITS_TO_SHOW
  );
}
