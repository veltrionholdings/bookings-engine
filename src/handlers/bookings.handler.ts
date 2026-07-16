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
import { normalizeEvent } from '../utils/event';
import { success, created, error } from '../utils/response';
import {
  listBookings,
  getBookingById,
  updateBooking,
} from '../repositories/booking.repository';
import { queryOne } from '../utils/db';
import {
  createBooking,
  cancelBooking,
  completeBooking,
  markNoShow,
} from '../services/booking.service';
import { getTenantById } from '../repositories/tenant.repository';
import { getServiceById } from '../repositories/service.repository';
import { createBookingSchema, updateBookingSchema, cancelBookingSchema } from '../models/validation';
import { ValidationError, ForbiddenError } from '../utils/errors';
import { localToUtc, addMinutesToDate, utcToLocal } from '../utils/time';
import { sendBookingConfirmationEmail, sendBookingCancellationEmail, sendBookingRescheduleEmail, sendBookingNoShowEmail } from '../services/email.service';
import { getCustomerById } from '../repositories/customer.repository';
import { getResourceById } from '../repositories/resource.repository';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const context = getRequestContext(event);
    const bookingId = event.pathParameters?.id;
    const { method, route } = normalizeEvent(event);

    if (route === '/bookings' && method === 'GET') {
      return await handleList(context.tenant_id, context.role, context.user_id, event.queryStringParameters, event);
    }
    if (route === '/bookings' && method === 'POST') {
      return await handleCreate(context.tenant_id, event.body, context.role);
    }
    if (route === '/bookings/{id}' && method === 'GET') {
      return await handleGet(context.tenant_id, bookingId!);
    }
    if (route === '/bookings/{id}' && method === 'PATCH') {
      return await handleUpdate(context.tenant_id, bookingId!, event.body);
    }
    if (route === '/bookings/{id}/cancel' && method === 'POST') {
      const isStaff = context.role === 'admin' || context.role === 'employee';
      return await handleCancel(context.tenant_id, bookingId!, event.body, isStaff);
    }
    if (route === '/bookings/{id}/complete' && method === 'POST') {
      if (context.role !== 'admin' && context.role !== 'employee') throw new ForbiddenError('Staff only');
      const booking = await completeBooking(context.tenant_id, bookingId!);
      return success(booking);
    }
    if (route === '/bookings/{id}/no-show' && method === 'POST') {
      if (context.role !== 'admin' && context.role !== 'employee') throw new ForbiddenError('Staff only');
      const booking = await markNoShow(context.tenant_id, bookingId!);

      // Send no-show email
      try {
        const tenant = await getTenantById(context.tenant_id);
        const customer = await getCustomerById(context.tenant_id, booking.customer_id);
        const service = await getServiceById(context.tenant_id, booking.service_id);
        const startLocal = utcToLocal(new Date(booking.start_time), tenant.timezone);
        const endLocal = utcToLocal(new Date(booking.end_time), tenant.timezone);
        const dateFormatted = new Date(startLocal).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
        const timeFormatted = `${startLocal.split('T')[1]?.substring(0, 5)} – ${endLocal.split('T')[1]?.substring(0, 5)}`;

        if (customer.email) {
          sendBookingNoShowEmail({
            customerEmail: customer.email,
            customerName: `${customer.first_name} ${customer.last_name}`,
            serviceName: service.name,
            date: dateFormatted,
            time: timeFormatted,
            businessName: tenant.name,
            businessPhone: '078 878 2527',
          });
        }
      } catch (emailErr) { console.error('No-show email failed:', emailErr); }

      return success(booking);
    }

    return error(new ValidationError(`Unsupported route: ${method} ${route}`));
  } catch (err) {
    return error(err);
  }
}

async function handleList(
  tenantId: string,
  role: string,
  userId: string,
  params: Record<string, string | undefined> | null,
  event: any
): Promise<APIGatewayProxyResult> {
  const filters: Record<string, string | undefined> = {
    status: params?.status,
    from: params?.from,
    to: params?.to,
    resource_id: params?.resource_id,
    customer_id: params?.customer_id,
  };

  // Customers can only see their own bookings — look up by email
  if (role === 'customer') {
    const authorizer = (event.requestContext as any).authorizer;
    const claims = authorizer?.jwt?.claims || authorizer?.claims;
    const email = claims?.email as string;

    if (email) {
      const customer = await queryOne<any>(
        'SELECT id FROM customers WHERE tenant_id = $1 AND email = $2',
        [tenantId, email]
      );
      if (customer) {
        filters.customer_id = customer.id;
      } else {
        // No customer record — return empty
        return success({ data: [], pagination: { next_cursor: null, has_more: false } });
      }
    } else {
      filters.customer_id = userId; // Fallback
    }
  }

  const limit = params?.limit ? parseInt(params.limit, 10) : 20;
  const cursor = params?.cursor;

  const result = await listBookings(tenantId, filters, limit, cursor);

  // Enrich bookings with service, customer, and resource names
  const tenant = await getTenantById(tenantId);
  const enrichedData = await Promise.all(
    result.data.map(async (booking) => {
      let serviceName = 'Unknown Service';
      let customerName = 'Unknown Customer';
      let customerPhone = '';
      let customerEmail = '';
      let resourceName = '';

      try {
        const service = await getServiceById(tenantId, booking.service_id);
        serviceName = service.name;
      } catch { /* ignore */ }

      try {
        const customer = await getCustomerById(tenantId, booking.customer_id);
        customerName = `${customer.first_name} ${customer.last_name}`;
        customerPhone = customer.phone || '';
        customerEmail = customer.email || '';
      } catch { /* ignore */ }

      if (booking.resource_id) {
        try {
          const resource = await getResourceById(tenantId, booking.resource_id);
          resourceName = resource.name;
        } catch { /* ignore */ }
      }

      return {
        ...booking,
        service: { id: booking.service_id, name: serviceName },
        customer: { id: booking.customer_id, first_name: customerName.split(' ')[0], last_name: customerName.split(' ').slice(1).join(' '), phone: customerPhone, email: customerEmail },
        resource: booking.resource_id ? { id: booking.resource_id, name: resourceName } : null,
        start_time_local: utcToLocal(new Date(booking.start_time), tenant.timezone),
        end_time_local: utcToLocal(new Date(booking.end_time), tenant.timezone),
      };
    })
  );

  return success({ data: enrichedData, pagination: result.pagination });
}

async function handleCreate(tenantId: string, body: string | null, role: string): Promise<APIGatewayProxyResult> {
  if (!body) throw new ValidationError('Request body is required');
  const parsed = createBookingSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new ValidationError('Invalid request body', { issues: parsed.error.issues });

  const isStaff = role === 'admin' || role === 'employee';

  const booking = await createBooking({
    tenant_id: tenantId,
    service_id: parsed.data.service_id,
    resource_id: parsed.data.resource_id ?? null,
    customer_id: parsed.data.customer_id,
    start_time: parsed.data.start_time,
    party_size: parsed.data.party_size,
    notes: parsed.data.notes,
    skip_validation: isStaff,
  });

  // Enrich response with local times
  const tenant = await getTenantById(tenantId);
  const startLocal = utcToLocal(new Date(booking.start_time), tenant.timezone);
  const endLocal = utcToLocal(new Date(booking.end_time), tenant.timezone);

  const enriched = {
    ...booking,
    start_time_local: startLocal,
    end_time_local: endLocal,
  };

  // Send confirmation email (fire-and-forget — don't block response)
  try {
    const customer = await getCustomerById(tenantId, booking.customer_id);
    const service = await getServiceById(tenantId, booking.service_id);
    const resource = booking.resource_id
      ? await getResourceById(tenantId, booking.resource_id)
      : null;

    const bookingDate = new Date(startLocal);
    const dateFormatted = bookingDate.toLocaleDateString('en-ZA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const startTime = startLocal.split('T')[1]?.substring(0, 5) || '';
    const endTime = endLocal.split('T')[1]?.substring(0, 5) || '';

    if (customer.email) {
      sendBookingConfirmationEmail({
        customerEmail: customer.email,
        customerName: `${customer.first_name} ${customer.last_name}`,
        serviceName: service.name,
        date: dateFormatted,
        time: `${startTime} – ${endTime}`,
        stylistName: resource?.name || 'Any Available',
        businessName: tenant.name,
        businessAddress: '271/206 Block IA, Soshanguve',
        businessPhone: '078 878 2527',
      });
    }
  } catch (emailErr) {
    console.error('Email send preparation failed:', emailErr);
  }

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

  // Get existing booking for comparison (needed for reschedule email)
  const existingBooking = await getBookingById(tenantId, id);
  const tenant = await getTenantById(tenantId);
  const updateData: Record<string, unknown> = {};
  let isReschedule = false;

  if (parsed.data.start_time) {
    isReschedule = true;
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

  const enriched = {
    ...booking,
    start_time_local: utcToLocal(new Date(booking.start_time), tenant.timezone),
    end_time_local: utcToLocal(new Date(booking.end_time), tenant.timezone),
  };

  // Send reschedule email if time changed (fire-and-forget)
  if (isReschedule) {
    try {
      const customer = await getCustomerById(tenantId, existingBooking.customer_id);
      const service = await getServiceById(tenantId, existingBooking.service_id);
      const resource = booking.resource_id ? await getResourceById(tenantId, booking.resource_id) : null;

      const oldStartLocal = utcToLocal(new Date(existingBooking.start_time), tenant.timezone);
      const oldEndLocal = utcToLocal(new Date(existingBooking.end_time), tenant.timezone);
      const newStartLocal = enriched.start_time_local;
      const newEndLocal = enriched.end_time_local;

      const oldDate = new Date(oldStartLocal).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
      const oldTime = `${oldStartLocal.split('T')[1]?.substring(0, 5)} – ${oldEndLocal.split('T')[1]?.substring(0, 5)}`;
      const newDate = new Date(newStartLocal).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
      const newTime = `${newStartLocal.split('T')[1]?.substring(0, 5)} – ${newEndLocal.split('T')[1]?.substring(0, 5)}`;

      if (customer.email) {
        sendBookingRescheduleEmail({
          customerEmail: customer.email,
          customerName: `${customer.first_name} ${customer.last_name}`,
          serviceName: service.name,
          oldDate,
          oldTime,
          newDate,
          newTime,
          stylistName: resource?.name || 'Any Available',
          businessName: tenant.name,
          businessPhone: '078 878 2527',
        });
      }
    } catch (emailErr) {
      console.error('Reschedule email failed:', emailErr);
    }
  }

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

  // Get booking details before cancellation for the email
  const existingBooking = await getBookingById(tenantId, id);
  const booking = await cancelBooking(tenantId, id, reason, isAdmin);

  // Send cancellation email (fire-and-forget)
  try {
    const tenant = await getTenantById(tenantId);
    const customer = await getCustomerById(tenantId, existingBooking.customer_id);
    const service = await getServiceById(tenantId, existingBooking.service_id);
    const startLocal = utcToLocal(new Date(existingBooking.start_time), tenant.timezone);
    const endLocal = utcToLocal(new Date(existingBooking.end_time), tenant.timezone);

    const bookingDate = new Date(startLocal);
    const dateFormatted = bookingDate.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const startTime = startLocal.split('T')[1]?.substring(0, 5) || '';
    const endTime = endLocal.split('T')[1]?.substring(0, 5) || '';

    if (customer.email) {
      sendBookingCancellationEmail({
        customerEmail: customer.email,
        customerName: `${customer.first_name} ${customer.last_name}`,
        serviceName: service.name,
        date: dateFormatted,
        time: `${startTime} – ${endTime}`,
        businessName: tenant.name,
        businessPhone: '078 878 2527',
        cancelledBy: isAdmin ? 'admin' : 'customer',
      });
    }
  } catch (emailErr) {
    console.error('Cancellation email failed:', emailErr);
  }

  return success(booking);
}
