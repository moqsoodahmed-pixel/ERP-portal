export class AppError extends Error {
  constructor(code, message, statusCode = 500, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}
export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details = []) { super('VALIDATION_ERROR', message, 400, details); }
}
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', code = 'AUTHENTICATION_ERROR') { super(code, message, 401); }
}
export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action') { super('AUTHORIZATION_ERROR', message, 403); }
}
export class TenantAccessError extends AppError {
  constructor(message = 'Access to the requested tenant is not permitted') { super('TENANT_ACCESS_ERROR', message, 403); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') { super('NOT_FOUND', message, 404); }
}
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') { super(code, message, 409); }
}
export class IntegrationError extends AppError {
  constructor(message = 'External integration error', code = 'INTEGRATION_ERROR', statusCode = 502) { super(code, message, statusCode); }
}
export class NotImplementedError extends AppError {
  constructor(feature = 'This capability') { super('NOT_IMPLEMENTED', `${feature} is not implemented yet`, 501); }
}
export class DatabaseError extends AppError {
  constructor(message = 'A database error occurred') { super('DATABASE_ERROR', message, 500); }
}
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') { super('RATE_LIMIT_EXCEEDED', message, 429); }
}
