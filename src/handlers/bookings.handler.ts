/**
 * Lambda handler for booking endpoints.
 * GET    /bookings              — List bookings
 * POST   /bookings              — Create a booking
 * GET    /bookings/:id          — Get a booking
 * PATCH  /bookings/:id          — Update a booking (reschedule)
 * POST   /bookings/:id/cancel   — Cancel a booking
 * POST   /bookings/:id/complete — Mark as completed
 * POST   /bookings/:id/no-show  — Mark as no-show
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRequestContext, requireAdmin } from '../utils/auth';
import { success, created, error } from '../utils/response';
import {
  listBookings,
  getBookingById,
  updateBooking,
} from '../repositories/booking.repository';
import {
  createBooking,
  cancelBooking,
  completeBooking,
  markNoShow,
} from '../services/booking.service';
import { getTenantById } from '../repositories/tenant.repository';
import { getServiceById } from '../repositories/service.repository';
import { createBookingSchema, updateBookingSchema, cancelBookingSchema } from '../models/validation';
import { ValidationError } from '../utils/errors';
import { localToUtc, addMinutesToDate, utcToLocal } from '../utils/time';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    const bookingId = event.pathParameters?.id;
    const path = event.resource;

    if (path === '/bookings' && event.httpMethod === 'GET') {
      return handleList(context.tenant_id, context.role, context.user_id, event.queryStringParameters);
    }
    if (path === '/bookings' && event.httpMethod === 'POST') {
      return handleCreate(context.tenant_id, event.body);
    }
    if (path === '/bookings/{id}' && event.httpMethod === 'GET') {
      return handleGet(context.tenant_id, bookingId!);
    }
    if (path === '/bookings/{id}' && event.httpMethod === 'PATCH') {
      return handleUpdate(context.tenant_id, bookingId!, event.body);
    }
    if (path === '/bookings/{id}/cancel' && event.httpMethod === 'POST') {
      return handleCancel(context.tenant_id, bookingId!, event.body, context.role === 'admin');
    }
    if (path === '/bookings/{id}/complete' && event.httpMethod === 'POST') {
      requireAdmin(context);
      const booking = await completeBooking(context.tenant_id, bookingId!);
      return success(booking);
    }
    if (path === '/bookings/{id}/no-show' && event.httpMethod === 'POST') {
      requireAdmin(context);
      const booking = await markNoShow(context.tenant_id, bookingId!);
      return success(booking);
    }

    return error(new ValidationError(`Unsupported route: ${event.httpMethod} ${path}`));
  } catch (err) {
    return error(err);
  }
}

async function handleList(
  tenantId: string,
  role: string,
  userId: string,
  params: Record<string, string> | null
): Promise<APIGatewayProxyResult> {
  const filters: Record<string, string | undefined> = {
    status: params?.status,
    from: params?.from,
    to: params?.to,
    resource_id: params?.resource_id,
    customer_id: params?.customer_id,
  };

  // Customers can only see their own bookings
  if (role === 'customer') {
    filters.customer_id = userId;
  }

  const limit = params?.limit ? parseInt(params.limit, 10) : 20;
  const cursor = params?.cursor;

  const result = await listBookings(tenantId, filters, limit, cursor);
  return success(result);
}

async function handleCreate(tenantId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = createBookingSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const booking = await createBooking({
    tenant_id: tenantId,
    service_id: parsed.data.service_id,
    resource_id: parsed.data.resource_id ?? null,
    customer_id: parsed.data.customer_id,
    start_time: parsed.data.start_time,
    party_size: parsed.data.party_size,
    notes: parsed.data.notes,
  });

  // Enrich response with local times
  const tenant = await getTenantById(tenantId);
  const enriched = {
    ...booking,
    start_time_local: utcToLocal(new Date(booking.start_time), tenant.timezone),
    end_time_local: utcToLocal(new Date(booking.end_time), tenant.timezone),
  };

  return created(enriched);
}

async function handleGet(tenantId: string, id: string): Promise<APIGatewayProxyResult> {
  const booking = await getBookingById(tenantId, id);
  const tenant = await getTenantById(tenantId);

  const enriched = {
    ...booking,
    start_time_local: utcToLocal(new Date(booking.start_time), tenant.timezone),
    end_time_local: utcToLocal(new Date(booking.end_time), tenant.timezone),
  };

  return success(enriched);
}

async function handleUpdate(tenantId: string, id: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = updateBookingSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const updateData: Record<string, unknown> = {};

  if (parsed.data.start_time) {
    // Rescheduling — recalculate end times
    const tenant = await getTenantById(tenantId);
    const existingBooking = await getBookingById(tenantId, id);
    const service = await getServiceById(tenantId, existingBooking.service_id);

    const newStartUtc = localToUtc(parsed.data.start_time, tenant.timezone);
    const newEndUtc = addMinutesToDate(newStartUtc, service.duration_minutes);
    const newBufferEndUtc = addMinutesToDate(newEndUtc, service.buffer_minutes);

    updateData.start_time = newStartUtc;
    updateData.end_time = newEndUtc;
    updateData.buffer_end_time = newBufferEndUtc;
  }

  if (parsed.data.resource_id) {
    updateData.resource_id = parsed.data.resource_id;
  }
  if (parsed.data.notes !== undefined) {
    updateData.notes = parsed.data.notes;
  }

  const booking = await updateBooking(tenantId, id, updateData as any);

  const tenant = await getTenantById(tenantId);
  const enriched = {
    ...booking,
    start_time_local: utcToLocal(new Date(booking.start_time), tenant.timezone),
    end_time_local: utcToLocal(new Date(booking.end_time), tenant.timezone),
  };

  return success(enriched);
}

async function handleCancel(
  tenantId: string,
  id: string,
  body: string | null,
  isAdmin: boolean
): Promise<APIGatewayProxyResult> {
  let reason: string | undefined;
  if (body) {
    const parsed = cancelBookingSchema.safeParse(JSON.parse(body));
    if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });
    reason = parsed.data.reason;
  }

  const booking = await cancelBooking(tenantId, id, reason, isAdmin);
  return success(booking);
}
