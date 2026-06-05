/**
 * Service data access layer.
 */

import { queryOne, queryMany, query } from '../utils/db';
import { Service, PaginatedResult } from '../models/types';
import { NotFoundError } from '../utils/errors';

export async function listServices(
  tenantId: string,
  filters: { resource_type_id?: string; is_active?: boolean },
  limit: number = 20,
  cursor?: string | null
): Promise<PaginatedResult<Service>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIndex = 2;

  if (filters.resource_type_id) {
    conditions.push(`resource_type_id = $${paramIndex++}`);
    params.push(filters.resource_type_id);
  }
  if (filters.is_active !== undefined) {
    conditions.push(`is_active = $${paramIndex++}`);
    params.push(filters.is_active);
  }
  if (cursor) {
    conditions.push(`id > $${paramIndex++}`);
    params.push(cursor);
  }

  params.push(limit + 1);
  const rows = await queryMany<Service>(
    `SELECT * FROM services
     WHERE ${conditions.join(' AND ')}
     ORDER BY id
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

export async function getServiceById(tenantId: string, id: string): Promise<Service> {
  const row = await queryOne<Service>(
    'SELECT * FROM services WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (!row) throw new NotFoundError('Service', id);
  return row;
}

export async function createService(
  tenantId: string,
  data: {
    name: string;
    description?: string;
    duration_minutes: number;
    buffer_minutes?: number;
    capacity?: number;
    resource_type_id: string;
    price_cents?: number;
    currency?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Service> {
  const row = await queryOne<Service>(
    `INSERT INTO services (tenant_id, name, description, duration_minutes, buffer_minutes, capacity, resource_type_id, price_cents, currency, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      tenantId,
      data.name,
      data.description ?? null,
      data.duration_minutes,
      data.buffer_minutes ?? 0,
      data.capacity ?? 1,
      data.resource_type_id,
      data.price_cents ?? null,
      data.currency ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  );
  return row!;
}

export async function updateService(
  tenantId: string,
  id: string,
  data: {
    name?: string;
    description?: string | null;
    duration_minutes?: number;
    buffer_minutes?: number;
    capacity?: number;
    price_cents?: number | null;
    currency?: string | null;
    is_active?: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<Service> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) { setClauses.push(`name = $${paramIndex++}`); params.push(data.name); }
  if (data.description !== undefined) { setClauses.push(`description = $${paramIndex++}`); params.push(data.description); }
  if (data.duration_minutes !== undefined) { setClauses.push(`duration_minutes = $${paramIndex++}`); params.push(data.duration_minutes); }
  if (data.buffer_minutes !== undefined) { setClauses.push(`buffer_minutes = $${paramIndex++}`); params.push(data.buffer_minutes); }
  if (data.capacity !== undefined) { setClauses.push(`capacity = $${paramIndex++}`); params.push(data.capacity); }
  if (data.price_cents !== undefined) { setClauses.push(`price_cents = $${paramIndex++}`); params.push(data.price_cents); }
  if (data.currency !== undefined) { setClauses.push(`currency = $${paramIndex++}`); params.push(data.currency); }
  if (data.is_active !== undefined) { setClauses.push(`is_active = $${paramIndex++}`); params.push(data.is_active); }
  if (data.metadata !== undefined) { setClauses.push(`metadata = $${paramIndex++}`); params.push(JSON.stringify(data.metadata)); }

  if (setClauses.length === 0) return getServiceById(tenantId, id);

  params.push(id, tenantId);
  const row = await queryOne<Service>(
    `UPDATE services SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
     RETURNING *`,
    params
  );

  if (!row) throw new NotFoundError('Service', id);
  return row;
}

export async function deactivateService(tenantId: string, id: string): Promise<void> {
  const result = await query(
    'UPDATE services SET is_active = false WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (result.rowCount === 0) throw new NotFoundError('Service', id);
}
