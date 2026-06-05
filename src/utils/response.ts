/**
 * API response helpers for consistent Lambda response formatting.
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { AppError } from './errors';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * Return a successful JSON response.
 */
export function success(body: unknown, statusCode: number = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Return a 201 Created response.
 */
export function created(body: unknown): APIGatewayProxyResult {
  return success(body, 201);
}

/**
 * Return a 204 No Content response.
 */
export function noContent(): APIGatewayProxyResult {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: '',
  };
}

/**
 * Return an error response. Handles both AppError and unexpected errors.
 */
export function error(err: unknown): APIGatewayProxyResult {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details && { details: err.details }),
        },
      }),
    };
  }

  // Unexpected error — log full details but return generic message
  console.error('Unexpected error:', err);
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    }),
  };
}
