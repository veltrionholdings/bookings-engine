/**
 * Lambda handler for resource endpoints.
 * GET    /resources              — List resources
 * POST   /resources              — Create a resource
 * GET    /resources/:id          — Get a resource
 * PATCH  /resources/:id          — Update a resource
 * DELETE /resources/:id          — Deactivate a resource
 * GET    /resources/:id/schedules       — Get weekly schedule
 * PUT    /resources/:id/schedules       — Replace weekly schedule
 * GET    /resources/:id/overrides       — List overrides
 * POST   /resources/:id/overrides       — Create override
 * DELETE /resources/:id/overrides/:oid  — Delete override
 * GET    /resources/:id/services        — List linked services
 * PUT    /resources/:id/services        — Set linked services
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequestContext, requireAdmin } from '../utils/auth';
import { normalizeEvent } from '../utils/event';
import { success, created, noContent, error } from '../utils/response';
import {
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deactivateResource,
  getResourceSchedules,
  setResourceSchedules,
  listOverrides,
  createOverride,
  deleteOverride,
  getResourceServiceIds,
  setResourceServices,
} from '../repositories/resource.repository';
import { getServiceById } from '../repositories/service.repository';
import {
  createResourceSchema,
  updateResourceSchema,
  setSchedulesSchema,
  createOverrideSchema,
  setResourceServicesSchema,
} from '../models/validation';
import { ValidationError } from '../utils/errors';
import { Service } from '../models/types';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    const resourceId = event.pathParameters?.id;
    const overrideId = event.pathParameters?.overrideId;
    const { method, route } = normalizeEvent(event);

    // Route based on path pattern and method
    if (route === '/resources' && method === 'GET') {
      return await handleList(context.tenant_id, event.queryStringParameters);
    }
    if (route === '/resources' && method === 'POST') {
      requireAdmin(context);
      return await handleCreate(context.tenant_id, event.body);
    }
    if (route === '/resources/{id}' && method === 'GET') {
      return await handleGet(context.tenant_id, resourceId!);
    }
    if (route === '/resources/{id}' && method === 'PATCH') {
      requireAdmin(context);
      return await handleUpdate(context.tenant_id, resourceId!, event.body);
    }
    if (route === '/resources/{id}' && method === 'DELETE') {
      requireAdmin(context);
      await deactivateResource(context.tenant_id, resourceId!);
      return noContent();
    }
    if (route === '/resources/{id}/schedules' && method === 'GET') {
      return await handleGetSchedules(resourceId!);
    }
    if (route === '/resources/{id}/schedules' && method === 'PUT') {
      requireAdmin(context);
      return await handleSetSchedules(resourceId!, event.body);
    }
    if (route === '/resources/{id}/overrides' && method === 'GET') {
      return await handleListOverrides(resourceId!, event.queryStringParameters);
    }
    if (route === '/resources/{id}/overrides' && method === 'POST') {
      requireAdmin(context);
      return await handleCreateOverride(resourceId!, event.body);
    }
    if (route === '/resources/{id}/overrides/{overrideId}' && method === 'DELETE') {
      requireAdmin(context);
      await deleteOverride(resourceId!, overrideId!);
      return noContent();
    }
    if (route === '/resources/{id}/services' && method === 'GET') {
      return await handleGetServices(context.tenant_id, resourceId!);
    }
    if (route === '/resources/{id}/services' && method === 'PUT') {
      requireAdmin(context);
      return await handleSetServices(context.tenant_id, resourceId!, event.body);
    }

    return error(new ValidationError(`Unsupported route: ${method} ${route}`));
  } catch (err) {
    return error(err);
  }
}

async function handleList(
  tenantId: string,
  params: Record<string, string | undefined> | null
): Promise<APIGatewayProxyResult> {
  const filters = {
    resource_type_id: params?.resource_type_id,
    is_active: params?.is_active ? params.is_active === 'true' : undefined,
  };
  const limit = params?.limit ? parseInt(params.limit, 10) : 20;
  const cursor = params?.cursor;

  const result = await listResources(tenantId, filters, limit, cursor);
  return success(result);
}

async function handleCreate(tenantId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = createResourceSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const resource = await createResource(tenantId, parsed.data);
  return created(resource);
}

async function handleGet(tenantId: string, id: string): Promise<APIGatewayProxyResult> {
  const resource = await getResourceById(tenantId, id);
  return success(resource);
}

async function handleUpdate(tenantId: string, id: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = updateResourceSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const resource = await updateResource(tenantId, id, parsed.data);
  return success(resource);
}

async function handleGetSchedules(resourceId: string): Promise<APIGatewayProxyResult> {
  const schedules = await getResourceSchedules(resourceId);
  return success({ data: schedules });
}

async function handleSetSchedules(resourceId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = setSchedulesSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const schedules = await setResourceSchedules(resourceId, parsed.data.schedules);
  return success({ data: schedules });
}

async function handleListOverrides(
  resourceId: string,
  params: Record<string, string | undefined> | null
): Promise<APIGatewayProxyResult> {
  const overrides = await listOverrides(resourceId, params?.from, params?.to);
  return success({ data: overrides });
}

async function handleCreateOverride(resourceId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = createOverrideSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const override = await createOverride(resourceId, parsed.data);
  return created(override);
}

async function handleGetServices(tenantId: string, resourceId: string): Promise<APIGatewayProxyResult> {
  const serviceIds = await getResourceServiceIds(resourceId);
  const services: Service[] = [];
  for (const sid of serviceIds) {
    services.push(await getServiceById(tenantId, sid));
  }
  return success({ data: services });
}

async function handleSetServices(tenantId: string, resourceId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = setResourceServicesSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  await setResourceServices(resourceId, parsed.data.service_ids);

  // Return the updated list
  const services: Service[] = [];
  for (const sid of parsed.data.service_ids) {
    services.push(await getServiceById(tenantId, sid));
  }
  return success({ data: services });
}
