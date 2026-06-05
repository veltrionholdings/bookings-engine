/**
 * Tenant data access layer.
 */

import { queryOne } from '../utils/db';
import { Tenant, TenantSettings } from '../models/types';
import { NotFoundError } from '../utils/errors';

export async function getTenantById(tenantId: string): Promise<Tenant> {
  const row = await queryOne<Tenant>(
    'SELECT * FROM tenants WHERE id = $1',
    [tenantId]
  );

  if (!row) {
    throw new NotFoundError('Tenant', tenantId);
  }

  return row;
}

export async function updateTenant(
  tenantId: string,
  updates: { name?: string; timezone?: string; settings?: Partial<TenantSettings> }
): Promise<Tenant> {
  // Build dynamic update query
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(updates.name);
  }

  if (updates.timezone !== undefined) {
    setClauses.push(`timezone = $${paramIndex++}`);
    params.push(updates.timezone);
  }

  if (updates.settings !== undefined) {
    // Deep merge settings using jsonb_deep_merge
    setClauses.push(`settings = settings || $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.settings));
  }

  if (setClauses.length === 0) {
    return getTenantById(tenantId);
  }

  params.push(tenantId);
  const sql = `
    UPDATE tenants 
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const row = await queryOne<Tenant>(sql, params);
  if (!row) {
    throw new NotFoundError('Tenant', tenantId);
  }

  return row;
}
