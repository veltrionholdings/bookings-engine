/**
 * Lambda handler for availability endpoint.
 * GET /availability — Check available time slots for a service on a date
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getTenantIdFromEvent } from '../utils/auth';
import { success, error } from '../utils/response';
import { getAvailability } from '../services/availability.service';
import { getAvailabilitySchema } from '../models/validation';
import { ValidationError } from '../utils/errors';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const tenantId = getTenantIdFromEvent(event);
    const params = event.queryStringParameters || {};

    const parsed = getAvailabilitySchema.safeParse({
      service_id: params.service_id,
      date: params.date,
      resource_id: params.resource_id,
    });

    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', { issues: parsed.error.issues });
    }

    const result = await getAvailability(
      tenantId,
      parsed.data.service_id,
      parsed.data.date,
      parsed.data.resource_id
    );

    return success(result);
  } catch (err) {
    return error(err);
  }
}
