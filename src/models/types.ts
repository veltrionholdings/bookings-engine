/**
 * Core domain types for the Bookings Engine.
 * These types represent the data structures used throughout the application.
 */

// ─── Enums ──────────────────────────────────────────────────────────────────────

export type BusinessType = 'gym' | 'restaurant' | 'salon' | 'nail_bar' | 'spa';

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export type AssignmentStrategy = 'first_available' | 'round_robin' | 'least_busy';

// ─── Tenant ─────────────────────────────────────────────────────────────────────

export interface TenantSettings {
  booking: {
    default_status: 'pending' | 'confirmed';
    allow_past_bookings: boolean;
    min_advance_minutes: number;
    max_advance_days: number;
    cancellation_window_minutes: number;
    allow_customer_cancellation: boolean;
    overbooking_allowed: boolean;
  };
  availability: {
    slot_interval_minutes: number;
    assignment_strategy: AssignmentStrategy;
  };
  notifications: {
    send_confirmation: boolean;
    send_reminder: boolean;
    reminder_hours_before: number;
  };
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  business_type: BusinessType;
  timezone: string;
  settings: TenantSettings;
  created_at: Date;
  updated_at: Date;
}

// ─── Resource Type ──────────────────────────────────────────────────────────────

export interface ResourceType {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

// ─── Resource ───────────────────────────────────────────────────────────────────

export interface Resource {
  id: string;
  tenant_id: string;
  resource_type_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// ─── Service ────────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  capacity: number;
  resource_type_id: string;
  price_cents: number | null;
  currency: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// ─── Resource Schedule ──────────────────────────────────────────────────────────

export interface ResourceSchedule {
  id: string;
  resource_id: string;
  day_of_week: number; // 0 = Monday, 6 = Sunday
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  is_active: boolean;
}

// ─── Schedule Override ──────────────────────────────────────────────────────────

export interface ScheduleOverride {
  id: string;
  resource_id: string;
  override_date: string; // YYYY-MM-DD
  is_available: boolean;
  start_time: string | null; // HH:mm
  end_time: string | null; // HH:mm
  reason: string | null;
}

// ─── Customer ───────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// ─── Booking ────────────────────────────────────────────────────────────────────

export interface Booking {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_id: string;
  resource_id: string | null;
  start_time: Date;
  end_time: Date;
  buffer_end_time: Date;
  status: BookingStatus;
  party_size: number;
  notes: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Availability ───────────────────────────────────────────────────────────────

export interface TimeSlot {
  start_time: string; // HH:mm (local)
  end_time: string; // HH:mm (local)
}

export interface AvailableSlot extends TimeSlot {
  resources: Array<{ id: string; name: string }>;
}

export interface AvailabilityResult {
  date: string;
  service: { id: string; name: string; duration_minutes: number };
  resource: { id: string; name: string } | null;
  slots: AvailableSlot[];
}

// ─── Pagination ─────────────────────────────────────────────────────────────────

export interface PaginationParams {
  limit: number;
  cursor: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

// ─── API Context ────────────────────────────────────────────────────────────────

export interface RequestContext {
  tenant_id: string;
  user_id: string;
  role: 'admin' | 'customer';
}
