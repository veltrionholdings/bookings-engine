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
 * Try to extract request context. Returns null if no auth is present.
 * Used for public endpoints that optionally accept auth.
 */
export function getOptionalRequestContext(event: APIGatewayProxyEvent): RequestContext | null {
  try {
    return getRequestContext(event);
  } catch {
    return null;
  }
}

/**
 * Get the tenant ID from the request context, or fall back to a default for public endpoints.
 * For a multi-tenant system with public endpoints, the tenant must be identified somehow.
 * For now, we use a hardcoded default tenant (Tas Hair) for public access.
 * In the future, this would come from a subdomain, API key, or path parameter.
 */
export function getTenantIdFromEvent(event: APIGatewayProxyEvent): string {
  const context = getOptionalRequestContext(event);
  if (context) return context.tenant_id;

  // Default tenant for public access (Tas Hair)
  // In production, this would be determined by subdomain or API key
  return process.env.DEFAULT_TENANT_ID || 'da8e5df8-f070-4671-a176-590a76c574b2';
}

/**
 * Require the admin role. Throws ForbiddenError if the user is not an admin.
 */
export function requireAdmin(context: RequestContext): void {
  if (context.role !== 'admin') {
    throw new ForbiddenError('This action requires admin privileges');
  }
}
