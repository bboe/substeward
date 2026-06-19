import type { Form, UiResponse } from '@devvit/web/shared';
import { enqueueVerification } from './process.js';

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

// Handle the verify-user form submission and return a toast summary.
export async function handleVerifyUserSubmit(
  values: VerifyUserFormValues
): Promise<UiResponse> {
  const username = values.username ?? '';
  if (username.trim() === '') {
    return { showToast: 'Please enter a username.' };
  }

  const message = await enqueueVerification(username);
  return { showToast: message };
}
