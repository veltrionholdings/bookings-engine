/**
 * Lambda handler for service endpoints.
 * GET    /services      — List services
 * POST   /services      — Create a service
 * GET    /services/:id  — Get a service
 * PATCH  /services/:id  — Update a service
 * DELETE /services/:id  — Deactivate a service
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequestContext, requireAdmin } from '../utils/auth';
import { success, created, noContent, error } from '../utils/response';
import {
  listServices,
  getServiceById,
  createService,
  updateService,
  deactivateService,
} from '../repositories/service.repository';
import { createServiceSchema, updateServiceSchema } from '../models/validation';
import { ValidationError } from '../utils/errors';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    const serviceId = event.pathParameters?.id;
    const path = event.resource;

    if (path === '/services' && event.httpMethod === 'GET') {
      return handleList(context.tenant_id, event.queryStringParameters);
    }
    if (path === '/services' && event.httpMethod === 'POST') {
      requireAdmin(context);
      return handleCreate(context.tenant_id, event.body);
    }
    if (path === '/services/{id}' && event.httpMethod === 'GET') {
      return handleGet(context.tenant_id, serviceId!);
    }
    if (path === '/services/{id}' && event.httpMethod === 'PATCH') {
      requireAdmin(context);
      return handleUpdate(context.tenant_id, serviceId!, event.body);
    }
    if (path === '/services/{id}' && event.httpMethod === 'DELETE') {
      requireAdmin(context);
      await deactivateService(context.tenant_id, serviceId!);
      return noContent();
    }

    return error(new ValidationError(`Unsupported route: ${event.httpMethod} ${path}`));
  } catch (err) {
    return error(err);
  }
}

async function handleList(
  tenantId: string,
  params: Record<string, string> | null
): Promise<APIGatewayProxyResult> {
  const filters = {
    resource_type_id: params?.resource_type_id,
    is_active: params?.is_active ? params.is_active === 'true' : undefined,
  };
  const limit = params?.limit ? parseInt(params.limit, 10) : 20;
  const cursor = params?.cursor;

  const result = await listServices(tenantId, filters, limit, cursor);
  return success(result);
}

async function handleCreate(tenantId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = createServiceSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const service = await createService(tenantId, parsed.data);
  return created(service);
}

async function handleGet(tenantId: string, id: string): Promise<APIGatewayProxyResult> {
  const service = await getServiceById(tenantId, id);
  return success(service);
}

async function handleUpdate(tenantId: string, id: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = updateServiceSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const service = await updateService(tenantId, id, parsed.data);
  return success(service);
}
