import { normalizeEvent } from '../../../src/utils/event';

describe('normalizeEvent', () => {
  describe('HTTP API v2 format', () => {
    it('extracts method and route from routeKey', () => {
      const event = {
        requestContext: { http: { method: 'GET' } },
        routeKey: 'GET /v1/services',
      };
      const { method, route } = normalizeEvent(event);
      expect(method).toBe('GET');
      expect(route).toBe('/services');
    });

    it('handles nested paths', () => {
      const event = {
        requestContext: { http: { method: 'PUT' } },
        routeKey: 'PUT /v1/resources/{id}/schedules',
      };
      const { method, route } = normalizeEvent(event);
      expect(method).toBe('PUT');
      expect(route).toBe('/resources/{id}/schedules');
    });

    it('handles path with multiple params', () => {
      const event = {
        requestContext: { http: { method: 'DELETE' } },
        routeKey: 'DELETE /v1/resources/{id}/overrides/{overrideId}',
      };
      const { method, route } = normalizeEvent(event);
      expect(method).toBe('DELETE');
      expect(route).toBe('/resources/{id}/overrides/{overrideId}');
    });

    it('handles POST with action paths', () => {
      const event = {
        requestContext: { http: { method: 'POST' } },
        routeKey: 'POST /v1/bookings/{id}/cancel',
      };
      const { method, route } = normalizeEvent(event);
      expect(method).toBe('POST');
      expect(route).toBe('/bookings/{id}/cancel');
    });
  });

  describe('REST API v1 format (fallback)', () => {
    it('falls back to httpMethod and resource', () => {
      const event = {
        httpMethod: 'GET',
        resource: '/services',
        requestContext: {},
      };
      const { method, route } = normalizeEvent(event);
      expect(method).toBe('GET');
      expect(route).toBe('/services');
    });
  });
});
