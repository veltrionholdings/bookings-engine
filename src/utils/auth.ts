/**
 * Authentication and authorization utilities.
 * Extracts tenant and user context from the JWT claims provided by API Gateway + Cognito.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { RequestContext } from '../models/types';
import { UnauthorizedError, ForbiddenError } from './errors';

/**
 * Extract the request context (tenant, user, role) from the API Gateway event.
 * The JWT is verified by API Gateway/Cognito before reaching Lambda,
 * so we just need to read the claims.
 *
 * HTTP API (v2) puts claims at: event.requestContext.authorizer.jwt.claims
 * REST API (v1) puts claims at: event.requestContext.authorizer.claims
 */
export function getRequestContext(event: APIGatewayProxyEvent): RequestContext {
  // HTTP API v2 format
  const authorizer = (event.requestContext as any).authorizer;
  const claims = authorizer?.jwt?.claims || authorizer?.claims;

  if (!claims) {
    throw new UnauthorizedError('No authorization claims found');
  }

  const tenantId = claims['custom:tenant_id'] as string;
  const userId = claims.sub as string;
  const role = (claims['custom:role'] as string) || 'customer';

  if (!tenantId) {
    throw new UnauthorizedError('No tenant_id in token claims');
  }

  if (!userId) {
    throw new UnauthorizedError('No user ID in token claims');
  }

  if (role !== 'admin' && role !== 'customer') {
    throw new UnauthorizedError('Invalid role in token claims');
  }

  return { tenant_id: tenantId, user_id: userId, role };
}

/**
 * Require the admin role. Throws ForbiddenError if the user is not an admin.
 */
export function requireAdmin(context: RequestContext): void {
  if (context.role !== 'admin') {
    throw new ForbiddenError('This action requires admin privileges');
  }
}
