/**
 * Booking business logic service.
 *
 * Handles booking creation (with conflict detection and resource assignment),
 * cancellation (with policy enforcement), and status transitions.
 */

import { Booking, Tenant } from '../models/types';
import { getTenantById } from '../repositories/tenant.repository';
import { getServiceById } from '../repositories/service.repository';
import { getResourceById, getResourcesForService } from '../repositories/resource.repository';
import {
  checkConflict,
  createBookingInTransaction,
  getBookingById,
  updateBookingStatus,
  getBookingCountsByResource,
} from '../repositories/booking.repository';
import { getAvailability } from './availability.service';
import { withTransaction } from '../utils/db';
import { ConflictError, ForbiddenError, ValidationError } from '../utils/errors';
import { localToUtc, addMinutesToDate } from '../utils/time';

interface CreateBookingInput {
  tenant_id: string;
  service_id: string;
  resource_id: string | null;
  customer_id: string;
  start_time: string; // ISO local time
  party_size: number;
  notes?: string;
}

/**
 * Create a booking with full validation, conflict detection, and resource assignment.
 */
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const tenant = await getTenantById(input.tenant_id);
  const service = await getServiceById(input.tenant_id, input.service_id);

  // Convert local start time to UTC
  const startTimeUtc = localToUtc(input.start_time, tenant.timezone);
  const endTimeUtc = addMinutesToDate(startTimeUtc, service.duration_minutes);
  const bufferEndTimeUtc = addMinutesToDate(endTimeUtc, service.buffer_minutes);

  // Validate advance booking rules
  const now = new Date();
  const minutesUntilStart = (startTimeUtc.getTime() - now.getTime()) / 60000;

  if (!tenant.settings.booking.allow_past_bookings && minutesUntilStart < 0) {
    throw new ValidationError('Cannot book in the past');
  }

  if (minutesUntilStart < tenant.settings.booking.min_advance_minutes) {
    throw new ValidationError(
      `Bookings must be made at least ${tenant.settings.booking.min_advance_minutes} minutes in advance`
    );
  }

  const maxAdvanceMinutes = tenant.settings.booking.max_advance_days * 24 * 60;
  if (minutesUntilStart > maxAdvanceMinutes) {
    throw new ValidationError(
      `Bookings cannot be made more than ${tenant.settings.booking.max_advance_days} days in advance`
    );
  }

  // Determine which resource to book
  let resourceId: string;

  if (input.resource_id) {
    // Customer picked a specific resource — validate it exists and can perform the service
    resourceId = input.resource_id;
    await getResourceById(input.tenant_id, resourceId);
  } else {
    // "Any available" — assign a resource based on strategy
    resourceId = await assignResource(
      input.tenant_id,
      input.service_id,
      input.start_time,
      tenant
    );
  }

  // Create booking within a transaction (atomic conflict check + insert)
  const booking = await withTransaction(async (client) => {
    // Lock-based conflict check inside transaction
    const hasConflict = await checkConflict(
      client,
      resourceId,
      startTimeUtc,
      bufferEndTimeUtc,
      service.id,
      service.capacity
    );

    if (hasConflict) {
      throw new ConflictError('The requested time slot is no longer available', {
        resource_id: resourceId,
        start_time: startTimeUtc.toISOString(),
      });
    }

    return createBookingInTransaction(client, {
      tenant_id: input.tenant_id,
      customer_id: input.customer_id,
      service_id: input.service_id,
      resource_id: resourceId,
      start_time: startTimeUtc,
      end_time: endTimeUtc,
      buffer_end_time: bufferEndTimeUtc,
      status: tenant.settings.booking.default_status,
      party_size: input.party_size,
      notes: input.notes,
    });
  });

  return booking;
}

/**
 * Cancel a booking, enforcing the cancellation window policy.
 */
export async function cancelBooking(
  tenantId: string,
  bookingId: string,
  reason?: string,
  isAdmin: boolean = false
): Promise<Booking> {
  const tenant = await getTenantById(tenantId);
  const booking = await getBookingById(tenantId, bookingId);

  // Only pending/confirmed bookings can be cancelled
  if (booking.status !== 'pending' && booking.status !== 'confirmed') {
    throw new ValidationError(`Cannot cancel a booking with status '${booking.status}'`);
  }

  // Check cancellation policy (admins can always cancel)
  if (!isAdmin) {
    if (!tenant.settings.booking.allow_customer_cancellation) {
      throw new ForbiddenError('Customer cancellation is not allowed. Please contact the business.');
    }

    const minutesUntilStart = (new Date(booking.start_time).getTime() - Date.now()) / 60000;
    if (minutesUntilStart < tenant.settings.booking.cancellation_window_minutes) {
      throw new ForbiddenError(
        `Cancellations must be made at least ${tenant.settings.booking.cancellation_window_minutes} minutes before the booking start time`
      );
    }
  }

  return updateBookingStatus(tenantId, bookingId, 'cancelled', {
    cancelled_at: new Date(),
    cancellation_reason: reason,
  });
}

/**
 * Mark a booking as completed.
 */
export async function completeBooking(tenantId: string, bookingId: string): Promise<Booking> {
  const booking = await getBookingById(tenantId, bookingId);

  if (booking.status !== 'confirmed') {
    throw new ValidationError(`Cannot complete a booking with status '${booking.status}'`);
  }

  return updateBookingStatus(tenantId, bookingId, 'completed');
}

/**
 * Mark a booking as no-show.
 */
export async function markNoShow(tenantId: string, bookingId: string): Promise<Booking> {
  const booking = await getBookingById(tenantId, bookingId);

  if (booking.status !== 'confirmed') {
    throw new ValidationError(`Cannot mark as no-show a booking with status '${booking.status}'`);
  }

  return updateBookingStatus(tenantId, bookingId, 'no_show');
}

/**
 * Assign a resource using the tenant's configured strategy.
 * Throws ConflictError if no resource is available.
 */
async function assignResource(
  tenantId: string,
  serviceId: string,
  startTimeLocal: string,
  tenant: Tenant
): Promise<string> {
  // Get availability to find who's free at the requested time
  const date = startTimeLocal.split('T')[0];
  const availability = await getAvailability(tenantId, serviceId, date);

  // Find the slot matching the requested start time
  const requestedTime = startTimeLocal.split('T')[1]?.substring(0, 5); // HH:mm
  const matchingSlot = availability.slots.find((s) => s.start_time === requestedTime);

  if (!matchingSlot || matchingSlot.resources.length === 0) {
    throw new ConflictError('No resources available at the requested time');
  }

  // Only one resource available — no strategy needed
  if (matchingSlot.resources.length === 1) {
    return matchingSlot.resources[0].id;
  }

  const strategy = tenant.settings.availability.assignment_strategy;
  const resourceIds = matchingSlot.resources.map(r => r.id);

  switch (strategy) {
    case 'first_available':
      return matchingSlot.resources[0].id;

    case 'round_robin': {
      // Distribute evenly: pick the resource with the fewest bookings this week
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);

      const counts = await getBookingCountsByResource(resourceIds, weekStart, weekEnd);
      let minCount = Infinity;
      let chosen = resourceIds[0];
      for (const id of resourceIds) {
        const count = counts.get(id) || 0;
        if (count < minCount) {
          minCount = count;
          chosen = id;
        }
      }
      return chosen;
    }

    case 'least_busy': {
      // Pick the resource with the fewest bookings on the requested day
      const dayStart = localToUtc(`${date}T00:00:00`, tenant.timezone);
      const dayEnd = localToUtc(`${date}T23:59:59`, tenant.timezone);

      const counts = await getBookingCountsByResource(resourceIds, dayStart, dayEnd);
      let minCount = Infinity;
      let chosen = resourceIds[0];
      for (const id of resourceIds) {
        const count = counts.get(id) || 0;
        if (count < minCount) {
          minCount = count;
          chosen = id;
        }
      }
      return chosen;
    }

    default:
      return matchingSlot.resources[0].id;
  }
}
