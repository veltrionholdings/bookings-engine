/**
 * Customer data access layer.
 */

import { queryOne, queryMany, query } from '../utils/db';
import { Customer, Booking, PaginatedResult } from '../models/types';
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
  // Deduplicate: if a customer with this email already exists, return them
  if (data.email) {
    const existing = await queryOne<Customer>(
      'SELECT * FROM customers WHERE tenant_id = $1 AND email = $2',
      [tenantId, data.email]
    );
    if (existing) {
      // Update their name/phone if provided (they might have changed)
      if (data.first_name || data.last_name || data.phone) {
        const updated = await queryOne<Customer>(
          `UPDATE customers SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name), phone = COALESCE($3, phone) WHERE id = $4 AND tenant_id = $5 RETURNING *`,
          [data.first_name || null, data.last_name || null, data.phone || null, existing.id, tenantId]
        );
        return updated || existing;
      }
      return existing;
    }
  }

  // Also check by phone if no email match
  if (data.phone && !data.email) {
    const existing = await queryOne<Customer>(
      'SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenantId, data.phone]
    );
    if (existing) return existing;
  }

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

/**
 * Delete a customer and anonymise their associated bookings (POPIA right to erasure).
 * Bookings are not deleted — they are anonymised so the business retains operational records.
 */
export async function deleteCustomer(tenantId: string, id: string): Promise<void> {
  // Verify customer exists
  await getCustomerById(tenantId, id);

  // Anonymise all bookings for this customer (replace customer reference with null notes)
  await query(
    `UPDATE bookings SET
       customer_id = $1,
       notes = '[Customer data deleted per POPIA request]'
     WHERE customer_id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );

  // Delete the customer record
  const result = await query(
    'DELETE FROM customers WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Customer', id);
  }
}

/**
 * Export all data held about a customer (POPIA right of access).
 * Returns the customer record plus all their bookings.
 */
export interface CustomerExport {
  customer: Customer;
  bookings: Booking[];
}

export async function exportCustomerData(tenantId: string, id: string): Promise<CustomerExport> {
  const customer = await getCustomerById(tenantId, id);

  const bookings = await queryMany<Booking>(
    `SELECT * FROM bookings
     WHERE customer_id = $1 AND tenant_id = $2
     ORDER BY start_time DESC`,
    [id, tenantId]
  );

  return { customer, bookings };
}
