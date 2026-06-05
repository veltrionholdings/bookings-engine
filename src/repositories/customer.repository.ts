/**
 * Customer data access layer.
 */

import { queryOne, queryMany } from '../utils/db';
import { Customer, PaginatedResult } from '../models/types';
import { NotFoundError } from '../utils/errors';

export async function listCustomers(
  tenantId: string,
  search?: string,
  limit: number = 20,
  cursor?: string | null
): Promise<PaginatedResult<Customer>> {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIndex = 2;

  if (search) {
    conditions.push(`(
      first_name ILIKE $${paramIndex} OR
      last_name ILIKE $${paramIndex} OR
      email ILIKE $${paramIndex} OR
      phone ILIKE $${paramIndex}
    )`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (cursor) {
    conditions.push(`id > $${paramIndex++}`);
    params.push(cursor);
  }

  params.push(limit + 1);
  const rows = await queryMany<Customer>(
    `SELECT * FROM customers
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

export async function getCustomerById(tenantId: string, id: string): Promise<Customer> {
  const row = await queryOne<Customer>(
    'SELECT * FROM customers WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (!row) throw new NotFoundError('Customer', id);
  return row;
}

export async function createCustomer(
  tenantId: string,
  data: {
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Customer> {
  const row = await queryOne<Customer>(
    `INSERT INTO customers (tenant_id, first_name, last_name, email, phone, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      tenantId,
      data.first_name,
      data.last_name,
      data.email ?? null,
      data.phone ?? null,
      data.notes ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  );
  return row!;
}

export async function updateCustomer(
  tenantId: string,
  id: string,
  data: {
    first_name?: string;
    last_name?: string;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<Customer> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.first_name !== undefined) { setClauses.push(`first_name = $${paramIndex++}`); params.push(data.first_name); }
  if (data.last_name !== undefined) { setClauses.push(`last_name = $${paramIndex++}`); params.push(data.last_name); }
  if (data.email !== undefined) { setClauses.push(`email = $${paramIndex++}`); params.push(data.email); }
  if (data.phone !== undefined) { setClauses.push(`phone = $${paramIndex++}`); params.push(data.phone); }
  if (data.notes !== undefined) { setClauses.push(`notes = $${paramIndex++}`); params.push(data.notes); }
  if (data.metadata !== undefined) { setClauses.push(`metadata = $${paramIndex++}`); params.push(JSON.stringify(data.metadata)); }

  if (setClauses.length === 0) return getCustomerById(tenantId, id);

  params.push(id, tenantId);
  const row = await queryOne<Customer>(
    `UPDATE customers SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
     RETURNING *`,
    params
  );

  if (!row) throw new NotFoundError('Customer', id);
  return row;
}
