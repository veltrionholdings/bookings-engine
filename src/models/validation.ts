/**
 * Request validation schemas using Zod.
 * These are used to validate incoming API requests before processing.
 */

import { z } from 'zod';

// ─── Common ─────────────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:mm format');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format');

// ─── Tenant ─────────────────────────────────────────────────────────────────────

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  timezone: z.string().min(1).max(100).optional(),
  settings: z.object({
    booking: z.object({
      default_status: z.enum(['pending', 'confirmed']).optional(),
      allow_past_bookings: z.boolean().optional(),
      min_advance_minutes: z.number().int().min(0).optional(),
      max_advance_days: z.number().int().min(1).optional(),
      cancellation_window_minutes: z.number().int().min(0).optional(),
      allow_customer_cancellation: z.boolean().optional(),
      overbooking_allowed: z.boolean().optional(),
    }).optional(),
    availability: z.object({
      slot_interval_minutes: z.number().int().min(5).optional(),
      assignment_strategy: z.enum(['first_available', 'round_robin', 'least_busy']).optional(),
    }).optional(),
    notifications: z.object({
      send_confirmation: z.boolean().optional(),
      send_reminder: z.boolean().optional(),
      reminder_hours_before: z.number().int().min(1).optional(),
    }).optional(),
  }).optional(),
});

// ─── Resource Types ─────────────────────────────────────────────────────────────

export const createResourceTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});

export const updateResourceTypeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
});

// ─── Resources ──────────────────────────────────────────────────────────────────

export const createResourceSchema = z.object({
  resource_type_id: uuid,
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateResourceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Schedules ──────────────────────────────────────────────────────────────────

export const setSchedulesSchema = z.object({
  schedules: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    start_time: timeString,
    end_time: timeString,
  })),
});

export const createOverrideSchema = z.object({
  override_date: dateString,
  is_available: z.boolean(),
  start_time: timeString.optional(),
  end_time: timeString.optional(),
  reason: z.string().max(255).optional(),
}).refine(
  (data) => {
    if (data.is_available) {
      return data.start_time !== undefined && data.end_time !== undefined;
    }
    return true;
  },
  { message: 'start_time and end_time are required when is_available is true' }
);

// ─── Services ───────────────────────────────────────────────────────────────────

export const createServiceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  duration_minutes: z.number().int().min(5),
  buffer_minutes: z.number().int().min(0).default(0),
  capacity: z.number().int().min(1).default(1),
  resource_type_id: uuid,
  price_cents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateServiceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  duration_minutes: z.number().int().min(5).optional(),
  buffer_minutes: z.number().int().min(0).optional(),
  capacity: z.number().int().min(1).optional(),
  price_cents: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Resource–Service Links ─────────────────────────────────────────────────────

export const setResourceServicesSchema = z.object({
  service_ids: z.array(uuid),
});

// ─── Customers ──────────────────────────────────────────────────────────────────

export const createCustomerSchema = z.object({
  first_name: z.string().min(1).max(255),
  last_name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateCustomerSchema = z.object({
  first_name: z.string().min(1).max(255).optional(),
  last_name: z.string().min(1).max(255).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Availability ───────────────────────────────────────────────────────────────

export const getAvailabilitySchema = z.object({
  service_id: uuid,
  date: dateString,
  resource_id: uuid.optional(),
});

// ─── Bookings ───────────────────────────────────────────────────────────────────

export const createBookingSchema = z.object({
  service_id: uuid,
  resource_id: uuid.nullable().optional(),
  customer_id: uuid,
  start_time: z.string().min(1), // ISO 8601 in tenant local time
  party_size: z.number().int().min(1).default(1),
  notes: z.string().max(2000).optional(),
});

export const updateBookingSchema = z.object({
  start_time: z.string().min(1).optional(),
  resource_id: uuid.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().max(255).optional(),
});
