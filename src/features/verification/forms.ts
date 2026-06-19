import type { Form, UiResponse } from '@devvit/web/shared';
import {
  prepareVerification,
  prepareVerificationForComment,
  prepareVerificationForPost,
  type VerifyAction,
} from './process.js';

export type VerifyUserFormValues = {
  username?: string;
};

// Build the modal form moderators use to verify a user by username.
export function buildVerifyUserForm(): Form {
  return {
    fields: [
      {
        name: 'username',
        label: 'Username',
        type: 'string',
        helpText: 'The redditor to verify (with or without the u/ prefix).',
        required: true,
      },
    ],
    title: 'Verify a user',
    acceptLabel: 'Verify',
    cancelLabel: 'Cancel',
  };
}

// Build the confirmation form shown when a user was verified recently.
function buildVerifyConfirmForm(username: string, description: string): Form {
  return {
    fields: [
      {
        name: 'username',
        label: 'Username',
        type: 'string',
        defaultValue: username,
        required: true,
      },
    ],
    title: 'Re-verify user?',
    description,
    acceptLabel: 'Re-verify',
    cancelLabel: 'Cancel',
  };
}

// Map a prepared verification action to a Reddit UI response.
function toUiResponse(action: VerifyAction): UiResponse {
  if (action.kind === 'confirm') {
    return {
      showForm: {
        name: 'verifyUserConfirm',
        form: buildVerifyConfirmForm(action.username, action.message),
      },
    };
  }
  return { showToast: action.message };
}

// Verify-user form submit: run pre-checks (may prompt for confirmation).
export async function handleVerifyUserSubmit(
  values: VerifyUserFormValues
): Promise<UiResponse> {
  const username = values.username ?? '';
  if (username.trim() === '') {
    return { showToast: 'Please enter a username.' };
  }
  return toUiResponse(await prepareVerification(username, false));
}

// Confirmation submit: force the re-verify the moderator approved.
export async function handleVerifyUserConfirmSubmit(
  values: VerifyUserFormValues
): Promise<UiResponse> {
  const username = values.username ?? '';
  if (username.trim() === '') {
    return { showToast: 'Please enter a username.' };
  }
  return toUiResponse(await prepareVerification(username, true));
}

// Comment menu: prepare verification for the comment's author.
export async function handleVerifyCommentAuthor(
  commentId: string
): Promise<UiResponse> {
  return toUiResponse(await prepareVerificationForComment(commentId));
}

// Post menu: prepare verification for the post's author.
export async function handleVerifyPostAuthor(
  postId: string
): Promise<UiResponse> {
  return toUiResponse(await prepareVerificationForPost(postId));
}
