import { isUniqueViolation } from './pg-errors.js';

const CONSTRAINT = 'applications_vacancy_id_candidate_id_unique';

function pgError(code: string, constraint: string): Error {
  return Object.assign(new Error('pg error'), { code, constraint });
}

describe('isUniqueViolation', () => {
  it('matches a unique violation on the named constraint', () => {
    expect(isUniqueViolation(pgError('23505', CONSTRAINT), CONSTRAINT)).toBe(
      true,
    );
  });

  it('matches a driver error wrapped as the cause (drizzle)', () => {
    const wrapped = new Error('Failed query', {
      cause: pgError('23505', CONSTRAINT),
    });

    expect(isUniqueViolation(wrapped, CONSTRAINT)).toBe(true);
  });

  it('rejects another pg error code', () => {
    expect(isUniqueViolation(pgError('23503', CONSTRAINT), CONSTRAINT)).toBe(
      false,
    );
  });

  it('rejects a unique violation on another constraint', () => {
    expect(
      isUniqueViolation(
        pgError('23505', 'candidates_email_unique'),
        CONSTRAINT,
      ),
    ).toBe(false);
  });

  it('rejects a wrapper whose cause is a different violation', () => {
    const wrapped = new Error('Failed query', {
      cause: pgError('23505', 'candidates_email_unique'),
    });

    expect(isUniqueViolation(wrapped, CONSTRAINT)).toBe(false);
  });

  it('rejects errors without pg fields and non-objects', () => {
    expect(isUniqueViolation(new Error('boom'), CONSTRAINT)).toBe(false);
    expect(isUniqueViolation('23505', CONSTRAINT)).toBe(false);
    expect(isUniqueViolation(null, CONSTRAINT)).toBe(false);
    expect(isUniqueViolation(undefined, CONSTRAINT)).toBe(false);
  });
});
