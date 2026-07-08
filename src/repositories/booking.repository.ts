/**
 * Booking data access layer.
 */

import { PoolClient } from 'pg';
import { queryOne, queryMany, query } from '../utils/db';
import { Booking, PaginatedResult } from '../models/types';
import { NotFoundError } from '../utils/errors';

export interface BookingFilters {
  status?: string;
  from?: string;
  to?: string;
  resource_id?: string;
  customer_id?: string;
}

export async function listBookings(
  tenantId: string,
  filters: BookingFilters,
  limit: number = 20,
  cursor?: string | null
): Promise<PaginatedResult<Booking>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIndex = 2;

  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(filters.status);
  }
  if (filters.from) {
    conditions.push(`start_time >= $${paramIndex++}::timestamptz`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`start_time < $${paramIndex++}::timestamptz`);
    params.push(filters.to);
  }
  if (filters.resource_id) {
    conditions.push(`resource_id = $${paramIndex++}`);
    params.push(filters.resource_id);
  }
  if (filters.customer_id) {
    conditions.push(`customer_id = $${paramIndex++}`);
    params.push(filters.customer_id);
  }
  if (cursor) {
    conditions.push(`id > $${paramIndex++}`);
    params.push(cursor);
  }

  params.push(limit + 1);
  const rows = await queryMany<Booking>(
    `SELECT * FROM bookings
     WHERE ${conditions.join(' AND ')}
     ORDER BY start_time DESC, id
     LIMIT $${paramIndex}`,
    params
  );

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  return {
    data,
    pagination: {
      next_cursor: hasMore ? data[data.length - 1].id : null,
      has_more: hasMore,
    },
  };
}

export async function getBookingById(tenantId: string, id: string): Promise<Booking> {
  const row = await queryOne<Booking>(
    'SELECT * FROM bookings WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (!row) throw new NotFoundError('Booking', id);
  return row;
}

/**
 * Check if a proposed booking conflicts with existing bookings.
 * For capacity-based services, checks if the slot is full.
 * Uses a transaction client for atomicity with the insert.
 */
export async function checkConflict(
  client: PoolClient,
  resourceId: string,
  startTime: Date,
  bufferEndTime: Date,
  serviceId: string,
  capacity: number
): Promise<boolean> {
  if (capacity > 1) {
    // Capacity-based: count existing bookings at this exact start time
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM bookings
       WHERE resource_id = $1
         AND service_id = $2
         AND start_time = $3
         AND status IN ('pending', 'confirmed')`,
      [resourceId, serviceId, startTime.toISOString()]
    );
    return parseInt(result.rows[0].count, 10) >= capacity;
  }

  // Single-capacity: check for any time overlap
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM bookings
     WHERE resource_id = $1
       AND status IN ('pending', 'confirmed')
       AND start_time < $2
       AND buffer_end_time > $3`,
    [resourceId, bufferEndTime.toISOString(), startTime.toISOString()]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * Create a booking using a transaction client (for atomic conflict check + insert).
 */
export async function createBookingInTransaction(
  client: PoolClient,
  data: {
    tenant_id: string;
    customer_id: string;
    service_id: string;
    resource_id: string;
    start_time: Date;
    end_time: Date;
    buffer_end_time: Date;
    status: string;
    party_size: number;
    notes?: string;
  }
): Promise<Booking> {
  const result = await client.query<Booking>(
    `INSERT INTO bookings (tenant_id, customer_id, service_id, resource_id, start_time, end_time, buffer_end_time, status, party_size, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.tenant_id,
      data.customer_id,
      data.service_id,
      data.resource_id,
      data.start_time.toISOString(),
      data.end_time.toISOString(),
      data.buffer_end_time.toISOString(),
      data.status,
      data.party_size,
      data.notes ?? null,
    ]
  );
  return result.rows[0];
}

export async function updateBookingStatus(
  tenantId: string,
  id: string,
  status: string,
  extra?: { cancelled_at?: Date; cancellation_reason?: string }
): Promise<Booking> {
  const setClauses = ['status = $1'];
  const params: unknown[] = [status];
  let paramIndex = 2;

  if (extra?.cancelled_at) {
    setClauses.push(`cancelled_at = $${paramIndex++}`);
    params.push(extra.cancelled_at.toISOString());
  }
  if (extra?.cancellation_reason) {
    setClauses.push(`cancellation_reason = $${paramIndex++}`);
    params.push(extra.cancellation_reason);
  }

  params.push(id, tenantId);
  const row = await queryOne<Booking>(
    `UPDATE bookings SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
     RETURNING *`,
    params
  );

  if (!row) throw new NotFoundError('Booking', id);
  return row;
}

export async function updateBooking(
  tenantId: string,
  id: string,
  data: { start_time?: Date; end_time?: Date; buffer_end_time?: Date; resource_id?: string; notes?: string | null }
): Promise<Booking> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.start_time !== undefined) { setClauses.push(`start_time = $${paramIndex++}`); params.push(data.start_time.toISOString()); }
  if (data.end_time !== undefined) { setClauses.push(`end_time = $${paramIndex++}`); params.push(data.end_time.toISOString()); }
  if (data.buffer_end_time !== undefined) { setClauses.push(`buffer_end_time = $${paramIndex++}`); params.push(data.buffer_end_time.toISOString()); }
  if (data.resource_id !== undefined) { setClauses.push(`resource_id = $${paramIndex++}`); params.push(data.resource_id); }
  if (data.notes !== undefined) { setClauses.push(`notes = $${paramIndex++}`); params.push(data.notes); }

  if (setClauses.length === 0) return getBookingById(tenantId, id);

  params.push(id, tenantId);
  const row = await queryOne<Booking>(
    `UPDATE bookings SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
       AND status IN ('pending', 'confirmed')
     RETURNING *`,
    params
  );

  if (!row) throw new NotFoundError('Booking', id);
  return row;
}

/**
 * Get all active bookings for a resource on a given date range (UTC).
 * Used for availability calculation.
 */
export async function getBookingsForResource(
  resourceId: string,
  dayStartUtc: Date,
  dayEndUtc: Date
): Promise<Booking[]> {
  return queryMany<Booking>(
    `SELECT * FROM bookings
     WHERE resource_id = $1
       AND status IN ('pending', 'confirmed')
       AND start_time < $2
       AND buffer_end_time > $3
     ORDER BY start_time`,
    [resourceId, dayEndUtc.toISOString(), dayStartUtc.toISOString()]
  );
}

/**
 * Count confirmed/pending bookings per resource for a date range.
 * Used by round_robin and least_busy assignment strategies.
 */
export async function getBookingCountsByResource(
  resourceIds: string[],
  startUtc: Date,
  endUtc: Date
): Promise<Map<string, number>> {
  if (resourceIds.length === 0) return new Map();

  const placeholders = resourceIds.map((_, i) => `$${i + 1}`).join(', ');
  const params: unknown[] = [...resourceIds, startUtc.toISOString(), endUtc.toISOString()];

  const rows = await queryMany<{ resource_id: string; count: string }>(
    `SELECT resource_id, COUNT(*) as count
     FROM bookings
     WHERE resource_id IN (${placeholders})
       AND status IN ('pending', 'confirmed')
       AND start_time >= $${resourceIds.length + 1}
       AND start_time < $${resourceIds.length + 2}
     GROUP BY resource_id`,
    params
  );

  const counts = new Map<string, number>();
  for (const id of resourceIds) {
    counts.set(id, 0);
  }
  for (const row of rows) {
    counts.set(row.resource_id, parseInt(row.count, 10));
  }

  return counts;
}
