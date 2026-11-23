/**
 * API Response Examples for Swagger Documentation
 * Used to provide consistent error response examples across all endpoints
 */

export const UNAUTHORIZED_EXAMPLE = {
  message: 'Unauthorized',
  statusCode: 401,
  timestamp: '2025-02-18T12:31:18.491Z',
  path: '/example/path',
};

export const FORBIDDEN_EXAMPLE = {
  message: 'Forbidden',
  statusCode: 403,
  timestamp: '2025-02-18T12:31:18.491Z',
  path: '/example/path',
};

export const BAD_REQUEST_EXAMPLE = {
  message: 'Bad Request',
  statusCode: 400,
  timestamp: '2025-02-18T12:31:18.491Z',
  path: '/example/path',
};

export const NOT_FOUND_EXAMPLE = {
  message: 'Resource not found',
  statusCode: 404,
  timestamp: '2025-02-18T12:31:18.491Z',
  path: '/example/path',
};

export const INTERNAL_SERVER_ERROR_EXAMPLE = {
  message: 'Internal server error',
  statusCode: 500,
  timestamp: '2025-02-18T12:31:18.491Z',
  path: '/example/path',
};
