/**
 * Resource and ResourceType data access layer.
 */

import { queryOne, queryMany, query } from '../utils/db';
import { Resource, ResourceType, ResourceSchedule, ScheduleOverride, PaginatedResult } from '../models/types';
import { NotFoundError } from '../utils/errors';

// ─── Resource Types ─────────────────────────────────────────────────────────────

export async function listResourceTypes(tenantId: string): Promise<ResourceType[]> {
  return queryMany<ResourceType>(
    'SELECT * FROM resource_types WHERE tenant_id = $1 ORDER BY name',
    [tenantId]
  );
}

export async function createResourceType(
  tenantId: string,
  data: { name: string; description?: string }
): Promise<ResourceType> {
  const row = await queryOne<ResourceType>(
    `INSERT INTO resource_types (tenant_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [tenantId, data.name, data.description ?? null]
  );
  return row!;
}

export async function updateResourceType(
  tenantId: string,
  id: string,
  data: { name?: string; description?: string | null }
): Promise<ResourceType> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(data.name);
  }
  if (data.description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    params.push(data.description);
  }

  if (setClauses.length === 0) {
    const existing = await queryOne<ResourceType>(
      'SELECT * FROM resource_types WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (!existing) throw new NotFoundError('ResourceType', id);
    return existing;
  }

  params.push(id, tenantId);
  const row = await queryOne<ResourceType>(
    `UPDATE resource_types SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
     RETURNING *`,
    params
  );

  if (!row) throw new NotFoundError('ResourceType', id);
  return row;
}

export async function deleteResourceType(tenantId: string, id: string): Promise<void> {
  const result = await query(
    'DELETE FROM resource_types WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (result.rowCount === 0) throw new NotFoundError('ResourceType', id);
}

// ─── Resources ──────────────────────────────────────────────────────────────────

export async function listResources(
  tenantId: string,
  filters: { resource_type_id?: string; is_active?: boolean },
  limit: number = 20,
  cursor?: string | null
): Promise<PaginatedResult<Resource>> {
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
  const rows = await queryMany<Resource>(
    `SELECT * FROM resources
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

export async function getResourceById(tenantId: string, id: string): Promise<Resource> {
  const row = await queryOne<Resource>(
    'SELECT * FROM resources WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (!row) throw new NotFoundError('Resource', id);
  return row;
}

export async function createResource(
  tenantId: string,
  data: { resource_type_id: string; name: string; description?: string; metadata?: Record<string, unknown> }
): Promise<Resource> {
  const row = await queryOne<Resource>(
    `INSERT INTO resources (tenant_id, resource_type_id, name, description, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, data.resource_type_id, data.name, data.description ?? null, JSON.stringify(data.metadata ?? {})]
  );
  return row!;
}

export async function updateResource(
  tenantId: string,
  id: string,
  data: { name?: string; description?: string | null; is_active?: boolean; metadata?: Record<string, unknown> }
): Promise<Resource> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(data.name);
  }
  if (data.description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    params.push(data.description);
  }
  if (data.is_active !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    params.push(data.is_active);
  }
  if (data.metadata !== undefined) {
    setClauses.push(`metadata = $${paramIndex++}`);
    params.push(JSON.stringify(data.metadata));
  }

  if (setClauses.length === 0) return getResourceById(tenantId, id);

  params.push(id, tenantId);
  const row = await queryOne<Resource>(
    `UPDATE resources SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
     RETURNING *`,
    params
  );

  if (!row) throw new NotFoundError('Resource', id);
  return row;
}

export async function deactivateResource(tenantId: string, id: string): Promise<void> {
  const result = await query(
    'UPDATE resources SET is_active = false WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  if (result.rowCount === 0) throw new NotFoundError('Resource', id);
}

// ─── Resource Schedules ─────────────────────────────────────────────────────────

export async function getResourceSchedules(resourceId: string): Promise<ResourceSchedule[]> {
  return queryMany<ResourceSchedule>(
    'SELECT * FROM resource_schedules WHERE resource_id = $1 AND is_active = true ORDER BY day_of_week, start_time',
    [resourceId]
  );
}

export async function setResourceSchedules(
  resourceId: string,
  schedules: Array<{ day_of_week: number; start_time: string; end_time: string }>
): Promise<ResourceSchedule[]> {
  // Delete existing and replace
  await query('DELETE FROM resource_schedules WHERE resource_id = $1', [resourceId]);

  if (schedules.length === 0) return [];

  const values: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const s of schedules) {
    values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
    params.push(resourceId, s.day_of_week, s.start_time, s.end_time);
    paramIndex += 4;
  }

  const rows = await queryMany<ResourceSchedule>(
    `INSERT INTO resource_schedules (resource_id, day_of_week, start_time, end_time)
     VALUES ${values.join(', ')}
     RETURNING *`,
    params
  );

  return rows;
}

// ─── Schedule Overrides ─────────────────────────────────────────────────────────

export async function listOverrides(
  resourceId: string,
  from?: string,
  to?: string
): Promise<ScheduleOverride[]> {
  const conditions = ['resource_id = $1'];
  const params: unknown[] = [resourceId];
  let paramIndex = 2;

  if (from) {
    conditions.push(`override_date >= $${paramIndex++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`override_date <= $${paramIndex++}`);
    params.push(to);
  }

  return queryMany<ScheduleOverride>(
    `SELECT * FROM schedule_overrides
     WHERE ${conditions.join(' AND ')}
     ORDER BY override_date`,
    params
  );
}

export async function createOverride(
  resourceId: string,
  data: { override_date: string; is_available: boolean; start_time?: string; end_time?: string; reason?: string }
): Promise<ScheduleOverride> {
  const row = await queryOne<ScheduleOverride>(
    `INSERT INTO schedule_overrides (resource_id, override_date, is_available, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (resource_id, override_date) DO UPDATE SET
       is_available = EXCLUDED.is_available,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       reason = EXCLUDED.reason
     RETURNING *`,
    [resourceId, data.override_date, data.is_available, data.start_time ?? null, data.end_time ?? null, data.reason ?? null]
  );
  return row!;
}

export async function deleteOverride(resourceId: string, overrideId: string): Promise<void> {
  const result = await query(
    'DELETE FROM schedule_overrides WHERE id = $1 AND resource_id = $2',
    [overrideId, resourceId]
  );
  if (result.rowCount === 0) throw new NotFoundError('ScheduleOverride', overrideId);
}

// ─── Resource–Service Links ─────────────────────────────────────────────────────

export async function getResourceServiceIds(resourceId: string): Promise<string[]> {
  const rows = await queryMany<{ service_id: string }>(
    'SELECT service_id FROM resource_service_links WHERE resource_id = $1',
    [resourceId]
  );
  return rows.map(r => r.service_id);
}

export async function setResourceServices(resourceId: string, serviceIds: string[]): Promise<void> {
  await query('DELETE FROM resource_service_links WHERE resource_id = $1', [resourceId]);

  if (serviceIds.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const serviceId of serviceIds) {
    values.push(`($${paramIndex}, $${paramIndex + 1})`);
    params.push(resourceId, serviceId);
    paramIndex += 2;
  }

  await query(
    `INSERT INTO resource_service_links (resource_id, service_id) VALUES ${values.join(', ')}`,
    params
  );
}

/**
 * Find all active resources that can perform a given service.
 */
export async function getResourcesForService(tenantId: string, serviceId: string): Promise<Resource[]> {
  return queryMany<Resource>(
    `SELECT r.* FROM resources r
     JOIN resource_service_links rsl ON rsl.resource_id = r.id
     WHERE rsl.service_id = $1
       AND r.tenant_id = $2
       AND r.is_active = true
     ORDER BY r.name`,
    [serviceId, tenantId]
  );
}
