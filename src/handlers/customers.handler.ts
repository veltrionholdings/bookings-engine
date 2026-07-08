/**
 * Lambda handler for customer endpoints.
 * GET    /customers            — List customers (admin only, supports search)
 * POST   /customers            — Create a customer
 * GET    /customers/:id        — Get a customer
 * PATCH  /customers/:id        — Update a customer
 * DELETE /customers/:id        — Delete a customer (POPIA right to erasure)
 * GET    /customers/:id/export — Export all customer data (POPIA right of access)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequestContext, requireAdmin } from '../utils/auth';
import { normalizeEvent } from '../utils/event';
import { success, created, noContent, error } from '../utils/response';
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  exportCustomerData,
} from '../repositories/customer.repository';
import { createCustomerSchema, updateCustomerSchema } from '../models/validation';
import { ValidationError } from '../utils/errors';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    const customerId = event.pathParameters?.id;
    const { method, route } = normalizeEvent(event);

    if (route === '/customers' && method === 'GET') {
      requireAdmin(context);
      return handleList(context.tenant_id, event.queryStringParameters);
    }
    if (route === '/customers' && method === 'POST') {
      return handleCreate(context.tenant_id, event.body);
    }
    if (route === '/customers/{id}' && method === 'GET') {
      return handleGet(context.tenant_id, customerId!);
    }
    if (route === '/customers/{id}' && method === 'PATCH') {
      return handleUpdate(context.tenant_id, customerId!, event.body);
    }
    if (route === '/customers/{id}' && method === 'DELETE') {
      requireAdmin(context);
      await deleteCustomer(context.tenant_id, customerId!);
      return noContent();
    }
    if (route === '/customers/{id}/export' && method === 'GET') {
      return handleExport(context.tenant_id, customerId!);
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
  const search = params?.search;
  const limit = params?.limit ? parseInt(params.limit, 10) : 20;
  const cursor = params?.cursor;

  const result = await listCustomers(tenantId, search, limit, cursor);
  return success(result);
}

async function handleCreate(tenantId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = createCustomerSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const customer = await createCustomer(tenantId, parsed.data);
  return created(customer);
}

async function handleGet(tenantId: string, id: string): Promise<APIGatewayProxyResult> {
  const customer = await getCustomerById(tenantId, id);
  return success(customer);
}

async function handleUpdate(tenantId: string, id: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = updateCustomerSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const customer = await updateCustomer(tenantId, id, parsed.data);
  return success(customer);
}

async function handleExport(tenantId: string, id: string): Promise<APIGatewayProxyResult> {
  const data = await exportCustomerData(tenantId, id);
  return success(data);
}
