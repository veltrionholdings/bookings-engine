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
 * Uses duck-typing instead of instanceof to survive esbuild minification.
 */
export function error(err: unknown): APIGatewayProxyResult {
  // Check if it's an AppError by shape (survives minification unlike instanceof)
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    'statusCode' in err &&
    'message' in err
  ) {
    const appErr = err as AppError;
    return {
      statusCode: appErr.statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: appErr.code,
          message: appErr.message,
          ...(appErr.details && { details: appErr.details }),
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
