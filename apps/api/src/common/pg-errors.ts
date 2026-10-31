const PG_UNIQUE_VIOLATION = '23505';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/**
 * True when `error` is a Postgres unique violation (23505) on the named
 * constraint. Drizzle wraps the driver's error in a `DrizzleQueryError`
 * (`code` and `constraint` live on its `cause`), so the cause chain is
 * followed as well as the error itself.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (
    let current = error, depth = 0;
    typeof current === 'object' && current !== null && depth < 5;
    current = (current as PgErrorLike).cause, depth++
  ) {
    const { code, constraint: name } = current as PgErrorLike;
    if (code === PG_UNIQUE_VIOLATION && name === constraint) return true;
  }
  return false;
}
