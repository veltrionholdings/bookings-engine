/**
 * Lambda handler for user management endpoints (admin only).
 * POST   /users/invite     — Invite a new user (employee or admin)
 * GET    /users            — List users for the tenant
 * POST   /users/:id/suspend — Suspend a user
 * POST   /users/:id/activate — Reactivate a suspended user
 * DELETE /users/:id        — Delete a user
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequestContext, requireAdmin } from '../utils/auth';
import { normalizeEvent } from '../utils/event';
import { success, created, noContent, error } from '../utils/response';
import { ValidationError } from '../utils/errors';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { z } from 'zod';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'eu-west-1',
});
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';

const inviteUserSchema = z.object({
  email: z.string().email(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  role: z.enum(['employee', 'admin']),
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    requireAdmin(context);

    const userId = event.pathParameters?.id;
    const { method, route } = normalizeEvent(event);

    if (route === '/users/invite' && method === 'POST') {
      return await handleInvite(context.tenant_id, event.body);
    }
    if (route === '/users' && method === 'GET') {
      return await handleList(context.tenant_id);
    }
    if (route === '/users/{id}/suspend' && method === 'POST') {
      return await handleSuspend(userId!);
    }
    if (route === '/users/{id}/activate' && method === 'POST') {
      return await handleActivate(userId!);
    }
    if (route === '/users/{id}' && method === 'DELETE') {
      return await handleDelete(userId!);
    }

    return error(new ValidationError(`Unsupported route: ${method} ${route}`));
  } catch (err) {
    return error(err);
  }
}

/**
 * Invite a new user. Creates them in Cognito with a temporary password.
 * Cognito sends them an email with their temp credentials to set up their account.
 */
async function handleInvite(tenantId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = inviteUserSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues as any });

  const { email, first_name, last_name, role } = parsed.data;

  await cognitoClient.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'given_name', Value: first_name },
      { Name: 'family_name', Value: last_name },
      { Name: 'custom:tenant_id', Value: tenantId },
      { Name: 'custom:role', Value: role },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
    // Cognito will send a welcome email with temporary password
  }));

  return created({
    message: `User ${email} invited as ${role}. They will receive an email with login instructions.`,
    email,
    role,
  });
}

/**
 * List all users for the tenant.
 */
async function handleList(tenantId: string): Promise<APIGatewayProxyResult> {
  const result = await cognitoClient.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
  }));

  const users = (result.Users || [])
    .map(user => {
      const attrs = user.Attributes || [];
      const getAttr = (name: string) => attrs.find(a => a.Name === name)?.Value || '';

      return {
        id: user.Username,
        email: getAttr('email'),
        first_name: getAttr('given_name'),
        last_name: getAttr('family_name'),
        role: getAttr('custom:role'),
        tenant_id: getAttr('custom:tenant_id'),
        status: user.Enabled ? (user.UserStatus || 'ACTIVE') : 'SUSPENDED',
        created_at: user.UserCreateDate?.toISOString(),
      };
    })
    .filter(user => user.tenant_id === tenantId);

  return success({ data: users });
}

/**
 * Suspend (disable) a user.
 */
async function handleSuspend(username: string): Promise<APIGatewayProxyResult> {
  await cognitoClient.send(new AdminDisableUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));

  return success({ message: `User ${username} has been suspended.` });
}

/**
 * Reactivate a suspended user.
 */
async function handleActivate(username: string): Promise<APIGatewayProxyResult> {
  await cognitoClient.send(new AdminEnableUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));

  return success({ message: `User ${username} has been reactivated.` });
}

/**
 * Delete a user permanently.
 */
async function handleDelete(username: string): Promise<APIGatewayProxyResult> {
  await cognitoClient.send(new AdminDeleteUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));

  return noContent();
}
