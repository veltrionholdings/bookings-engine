import { success, created, noContent, error } from '../../../src/utils/response';
import { ValidationError, NotFoundError } from '../../../src/utils/errors';

describe('success', () => {
  it('returns 200 with JSON body', () => {
    const result = success({ name: 'test' });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ name: 'test' });
    expect(result.headers?.['Content-Type']).toBe('application/json');
  });

  it('supports custom status code', () => {
    const result = success({ ok: true }, 202);
    expect(result.statusCode).toBe(202);
  });
});

describe('created', () => {
  it('returns 201', () => {
    const result = created({ id: '123' });
    expect(result.statusCode).toBe(201);
  });
});

describe('noContent', () => {
  it('returns 204 with empty body', () => {
    const result = noContent();
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
  });
});

describe('error', () => {
  it('handles AppError correctly', () => {
    const err = new ValidationError('Bad field', { field: 'name' });
    const result = error(err);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Bad field');
    expect(body.error.details).toEqual({ field: 'name' });
  });

  it('handles NotFoundError', () => {
    const err = new NotFoundError('Booking', '456');
    const result = error(err);
    expect(result.statusCode).toBe(404);
  });

  it('handles unexpected errors with 500', () => {
    const err = new Error('something broke');
    const result = error(err);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('does not expose internal error details', () => {
    const err = new Error('DB password leaked');
    const result = error(err);
    const body = JSON.parse(result.body);
    expect(body.error.message).not.toContain('password');
  });
});
