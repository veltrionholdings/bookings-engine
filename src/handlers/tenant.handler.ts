/**
 * Lambda handler for tenant endpoints.
 * GET /tenant — Get current tenant profile
 * PATCH /tenant — Update tenant settings
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequestContext, requireAdmin } from '../utils/auth';
import { normalizeEvent } from '../utils/event';
import { success, error } from '../utils/response';
import { getTenantById, updateTenant } from '../repositories/tenant.repository';
import { updateTenantSchema } from '../models/validation';
import { ValidationError } from '../utils/errors';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    const { method } = normalizeEvent(event);

    switch (method) {
      case 'GET':
        return handleGet(context.tenant_id);
      case 'PATCH':
        requireAdmin(context);
        return handlePatch(context.tenant_id, event.body);
      default:
        return error(new ValidationError(`Unsupported method: ${method}`));
    }
  } catch (err) {
    return error(err);
  }
}

async function handleGet(tenantId: string): Promise<APIGatewayProxyResult> {
  const tenant = await getTenantById(tenantId);
  return success(tenant);
}

async function handlePatch(tenantId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');

  const parsed = updateTenantSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new ValidationError('Invalid request body', { issues: parsed.error.issues });
  }

  const tenant = await updateTenant(tenantId, parsed.data as any);
  return success(tenant);
}
