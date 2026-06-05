/**
 * Availability calculation service.
 *
 * This is the core scheduling logic. Given a service and a date, it computes
 * which time slots are available for booking, respecting:
 * - Resource schedules and overrides
 * - Existing bookings (conflict detection)
 * - Service duration and buffer
 * - Tenant configuration (slot intervals, advance booking rules)
 */

import { Tenant, Resource, Service, AvailabilityResult, AvailableSlot } from '../models/types';
import { getResourcesForService, getResourceSchedules } from '../repositories/resource.repository';
import { listOverrides } from '../repositories/resource.repository';
import { getBookingsForResource } from '../repositories/booking.repository';
import { getServiceById } from '../repositories/service.repository';
import { getTenantById } from '../repositories/tenant.repository';
import { getResourceById } from '../repositories/resource.repository';
import {
  getDayOfWeek,
  timeToMinutes,
  minutesToTime,
  timeAndDateToUtc,
  addMinutesToDate,
} from '../utils/time';

interface TimeWindow {
  startMinutes: number; // minutes since midnight (local)
  endMinutes: number;
}

/**
 * Main availability calculation.
 */
export async function getAvailability(
  tenantId: string,
  serviceId: string,
  date: string, // YYYY-MM-DD
  resourceId?: string
): Promise<AvailabilityResult> {
  const tenant = await getTenantById(tenantId);
  const service = await getServiceById(tenantId, serviceId);

  // Determine which resources to check
  let resources: Resource[];
  if (resourceId) {
    const resource = await getResourceById(tenantId, resourceId);
    resources = [resource];
  } else {
    resources = await getResourcesForService(tenantId, serviceId);
  }

  const totalDuration = service.duration_minutes + service.buffer_minutes;
  const slotInterval = tenant.settings.availability.slot_interval_minutes;

  // Calculate slots for each resource
  const slotMap = new Map<string, Array<{ id: string; name: string }>>();

  for (const resource of resources) {
    const availableSlots = await calculateResourceSlots(
      resource,
      service,
      date,
      tenant,
      totalDuration,
      slotInterval
    );

    for (const slotTime of availableSlots) {
      const existing = slotMap.get(slotTime) || [];
      existing.push({ id: resource.id, name: resource.name });
      slotMap.set(slotTime, existing);
    }
  }

  // Sort slots by time and build response
  const sortedSlotTimes = Array.from(slotMap.keys()).sort();
  const slots: AvailableSlot[] = sortedSlotTimes.map((startTime) => {
    const endMinutes = timeToMinutes(startTime) + service.duration_minutes;
    return {
      start_time: startTime,
      end_time: minutesToTime(endMinutes),
      resources: slotMap.get(startTime)!,
    };
  });

  return {
    date,
    service: { id: service.id, name: service.name, duration_minutes: service.duration_minutes },
    resource: resourceId ? { id: resources[0].id, name: resources[0].name } : null,
    slots,
  };
}

/**
 * Calculate available slot start times for a single resource on a given date.
 */
async function calculateResourceSlots(
  resource: Resource,
  service: Service,
  date: string,
  tenant: Tenant,
  totalDuration: number,
  slotInterval: number
): Promise<string[]> {
  // Step 1: Get working windows for this date
  const windows = await getWorkingWindows(resource.id, date, tenant.timezone);
  if (windows.length === 0) return [];

  // Step 2: Generate candidate start times
  const candidates: number[] = [];
  for (const window of windows) {
    let startMinutes = window.startMinutes;
    // Snap to slot interval
    const remainder = startMinutes % slotInterval;
    if (remainder !== 0) {
      startMinutes += slotInterval - remainder;
    }

    while (startMinutes + totalDuration <= window.endMinutes) {
      candidates.push(startMinutes);
      startMinutes += slotInterval;
    }
  }

  if (candidates.length === 0) return [];

  // Step 3: Get existing bookings for conflict check
  const dayStartUtc = timeAndDateToUtc('00:00', date, tenant.timezone);
  const dayEndUtc = timeAndDateToUtc('23:59', date, tenant.timezone);
  const existingBookings = await getBookingsForResource(resource.id, dayStartUtc, dayEndUtc);

  // Step 4: Filter out conflicting slots
  const now = new Date();
  const minAdvanceMinutes = tenant.settings.booking.min_advance_minutes;
  const availableSlots: string[] = [];

  for (const candidateMinutes of candidates) {
    const startTimeStr = minutesToTime(candidateMinutes);
    const slotStartUtc = timeAndDateToUtc(startTimeStr, date, tenant.timezone);
    const slotBufferEndUtc = addMinutesToDate(slotStartUtc, totalDuration);

    // Check minimum advance time
    const minutesUntilSlot = (slotStartUtc.getTime() - now.getTime()) / 60000;
    if (minutesUntilSlot < minAdvanceMinutes) continue;

    // Check conflicts
    const hasConflict = existingBookings.some((booking) => {
      if (service.capacity > 1) {
        // Capacity-based: only conflicts if same start time and at capacity
        if (booking.service_id === service.id && booking.start_time.getTime() === slotStartUtc.getTime()) {
          // Count how many bookings at this exact time
          const countAtTime = existingBookings.filter(
            (b) => b.service_id === service.id && b.start_time.getTime() === slotStartUtc.getTime()
          ).length;
          return countAtTime >= service.capacity;
        }
        return false;
      }

      // Single-capacity: overlap check
      const bookingStart = new Date(booking.start_time).getTime();
      const bookingBufferEnd = new Date(booking.buffer_end_time).getTime();
      const proposedStart = slotStartUtc.getTime();
      const proposedBufferEnd = slotBufferEndUtc.getTime();

      return bookingStart < proposedBufferEnd && bookingBufferEnd > proposedStart;
    });

    if (!hasConflict) {
      availableSlots.push(startTimeStr);
    }
  }

  return availableSlots;
}

/**
 * Get the working time windows for a resource on a specific date.
 * Checks overrides first, then falls back to recurring schedule.
 */
async function getWorkingWindows(
  resourceId: string,
  date: string,
  timezone: string
): Promise<TimeWindow[]> {
  // Check for override on this date
  const overrides = await listOverrides(resourceId, date, date);

  if (overrides.length > 0) {
    const override = overrides[0];
    if (!override.is_available) return []; // Day off
    if (override.start_time && override.end_time) {
      return [{
        startMinutes: timeToMinutes(override.start_time),
        endMinutes: timeToMinutes(override.end_time),
      }];
    }
  }

  // No override — use recurring schedule
  const dateObj = new Date(`${date}T12:00:00`); // Noon to avoid DST edge cases
  const dayOfWeek = getDayOfWeek(dateObj, timezone);

  const schedules = await getResourceSchedules(resourceId);
  const daySchedules = schedules.filter((s) => s.day_of_week === dayOfWeek && s.is_active);

  return daySchedules.map((s) => ({
    startMinutes: timeToMinutes(s.start_time),
    endMinutes: timeToMinutes(s.end_time),
  }));
}
