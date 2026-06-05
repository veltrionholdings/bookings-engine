/**
 * Event normalization for API Gateway HTTP API (v2) and REST API (v1).
 *
 * HTTP API v2 uses:
 *  - event.requestContext.http.method (instead of event.httpMethod)
 *  - event.routeKey e.g. "GET /v1/services" (instead of event.resource)
 *  - event.pathParameters still works the same
 *
 * This utility extracts method and a normalized route pattern.
 */

export interface NormalizedEvent {
  method: string;
  /** Route pattern like "/services" or "/services/{id}" */
  route: string;
}

export function normalizeEvent(event: any): NormalizedEvent {
  // HTTP API v2 format
  if (event.requestContext?.http?.method) {
    const method = event.requestContext.http.method;
    // routeKey is like "GET /v1/services/{id}"
    const routeKey: string = event.routeKey || '';
    // Strip the method prefix and the /v1 prefix
    const route = routeKey
      .replace(/^(GET|POST|PATCH|PUT|DELETE|OPTIONS)\s+/, '')
      .replace(/^\/v1/, '')
      || '/';
    return { method, route };
  }

  // REST API v1 format (fallback)
  return {
    method: event.httpMethod || 'GET',
    route: event.resource || '/',
  };
}
