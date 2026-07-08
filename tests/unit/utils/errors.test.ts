import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '../../../src/utils/errors';

describe('ValidationError', () => {
  it('has correct code and status', () => {
    const err = new ValidationError('Invalid input');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid input');
  });

  it('includes details when provided', () => {
    const err = new ValidationError('Bad request', { field: 'email' });
    expect(err.details).toEqual({ field: 'email' });
  });
});

describe('NotFoundError', () => {
  it('has correct code and status', () => {
    const err = new NotFoundError('Service', '123');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Service with id '123' not found");
  });

  it('works without id', () => {
    const err = new NotFoundError('Customer');
    expect(err.message).toBe('Customer not found');
  });
});

describe('ConflictError', () => {
  it('has correct code and status', () => {
    const err = new ConflictError('Slot taken');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
  });
});

describe('ForbiddenError', () => {
  it('has correct code and status', () => {
    const err = new ForbiddenError();
    expect(err.code).toBe('FORBIDDEN');
    expect(err.statusCode).toBe(403);
  });
});

describe('UnauthorizedError', () => {
  it('has correct code and status', () => {
    const err = new UnauthorizedError();
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
  });
});
