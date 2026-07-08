/**
 * Lambda handler for resource type endpoints.
 * GET    /resource-types      — List resource types
 * POST   /resource-types      — Create a resource type
 * PATCH  /resource-types/:id  — Update a resource type
 * DELETE /resource-types/:id  — Delete a resource type
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequestContext, requireAdmin } from '../utils/auth';
import { normalizeEvent } from '../utils/event';
import { success, created, noContent, error } from '../utils/response';
import {
  listResourceTypes,
  createResourceType,
  updateResourceType,
  deleteResourceType,
} from '../repositories/resource.repository';
import { createResourceTypeSchema, updateResourceTypeSchema } from '../models/validation';
import { ValidationError } from '../utils/errors';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    const id = event.pathParameters?.id;
    const { method, route } = normalizeEvent(event);

    if (route === '/resource-types' && method === 'GET') {
      const types = await listResourceTypes(context.tenant_id);
      return success({ data: types });
    }
    if (route === '/resource-types' && method === 'POST') {
      requireAdmin(context);
      return await handleCreate(context.tenant_id, event.body);
    }
    if (route === '/resource-types/{id}' && method === 'PATCH') {
      requireAdmin(context);
      return await handleUpdate(context.tenant_id, id!, event.body);
    }
    if (route === '/resource-types/{id}' && method === 'DELETE') {
      requireAdmin(context);
      await deleteResourceType(context.tenant_id, id!);
      return noContent();
    }

    return error(new ValidationError(`Unsupported route: ${method} ${route}`));
  } catch (err) {
    return error(err);
  }
}

async function handleCreate(tenantId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = createResourceTypeSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const resourceType = await createResourceType(tenantId, parsed.data);
  return created(resourceType);
}

async function handleUpdate(tenantId: string, id: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = updateResourceTypeSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const resourceType = await updateResourceType(tenantId, id, parsed.data);
  return success(resourceType);
}
