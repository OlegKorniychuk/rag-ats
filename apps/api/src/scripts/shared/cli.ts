/**
 * Helpers shared by the dev-only eval CLIs (`parse-eval`, `score-eval`): repo
 * paths, argument parsing and env loading. Never imported by the app itself.
 */
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { config as loadDotenv } from 'dotenv';
import { EnvConfig } from '../../config/env.config.js';

// dist/scripts/shared/cli.js -> repo root is five levels up.
export const REPO_ROOT = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);
export const API_ENV_FILE = join(REPO_ROOT, 'apps', 'api', '.env');

export const fromRoot = (p: string): string =>
  isAbsolute(p) ? p : resolve(REPO_ROOT, p);

/** A bad flag or env: printed without a stack, exit code 2. */
export class UsageError extends Error {}

export function parseNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
  integer = false,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && (!Number.isInteger(value) || value < 1))
  ) {
    throw new UsageError(
      `--${name} must be ${integer ? 'a positive integer' : 'a non-negative number'}`,
    );
  }
  return value;
}

/**
 * Same schema and validator options as the app's TypedConfigModule, but the
 * error lists only property names and rules, never values (which may be
 * secrets).
 */
export function loadEnv(): EnvConfig {
  loadDotenv({ path: API_ENV_FILE, quiet: true }); // does not override real env
  const config = plainToInstance(EnvConfig, process.env, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(config, {
    forbidUnknownValues: true,
    whitelist: true,
  });
  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
      )
      .join('\n');
    throw new UsageError(
      `Invalid environment (loaded from process env and ${API_ENV_FILE}):\n${details}`,
    );
  }
  return config;
}
