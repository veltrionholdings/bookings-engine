/**
 * Cognito Pre Token Generation trigger.
 *
 * Ensures every issued token carries the custom claims the API depends on:
 *   - custom:tenant_id  (defaults to the Tas Hair tenant)
 *   - custom:role       (defaults to 'customer')
 *
 * Native (email/password) users get these attributes set at sign-up, but
 * federated users (e.g. Google) do not go through our sign-up flow, so their
 * tokens would otherwise be missing these claims and every authenticated API
 * call would be rejected by the JWT authorizer + getRequestContext().
 *
 * This trigger only fills in claims that are absent — it never overrides an
 * existing tenant_id or role (so admins/employees keep their assigned role).
 */

import { PreTokenGenerationTriggerEvent } from 'aws-lambda';

const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID || 'da8e5df8-f070-4671-a176-590a76c574b2';

export async function handler(
  event: PreTokenGenerationTriggerEvent
): Promise<PreTokenGenerationTriggerEvent> {
  const existing = event.request.userAttributes || {};

  const claimsToAddOrOverride: Record<string, string> = {};

  if (!existing['custom:tenant_id']) {
    claimsToAddOrOverride['custom:tenant_id'] = DEFAULT_TENANT_ID;
  }
  if (!existing['custom:role']) {
    claimsToAddOrOverride['custom:role'] = 'customer';
  }

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride,
    },
  };

  return event;
}
