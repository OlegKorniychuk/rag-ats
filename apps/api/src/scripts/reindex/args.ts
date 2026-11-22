import { parseArgs } from 'node:util';
import { UsageError } from '../shared/cli.js';

export const REINDEX_USAGE = [
  'Usage: reindex --chunk-max-chars <n> [options]',
  '  Rebuilds candidate_chunks of an experiment copy of the seeded database',
  '  (DATABASE_URL must name a database rag_ats_exp_*) with the given CV chunk',
  '  size and the embedding model from OPENAI_EMBEDDING_MODEL.',
  '  --chunk-max-chars <n>   CV chunk size in characters (integer >= 200)',
  '  --max-usd <n>           stop starting candidates when spend plus the next estimate reaches n (default 0.1)',
  '  --dry-run               print the chunk counts and the cost estimate, no LLM calls, nothing written',
].join('\n');

export const MIN_CHUNK_MAX_CHARS = 200;
export const DEFAULT_REINDEX_MAX_USD = 0.1;
/** Only databases with this prefix may be rewritten. */
export const EXPERIMENT_DB_PREFIX = 'rag_ats_exp_';

export interface ReindexArgs {
  cvMaxChars: number;
  dryRun: boolean;
  maxUsd: number;
}

/** Parses the CLI flags; a bad or missing flag throws `UsageError`. */
export function parseReindexArgs(argv: string[]): ReindexArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'chunk-max-chars': { type: 'string' },
        'max-usd': { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const rawSize = values['chunk-max-chars'] as string | undefined;
  if (rawSize === undefined) {
    throw new UsageError('--chunk-max-chars is required');
  }
  const size = Number(rawSize);
  if (
    rawSize.trim() === '' ||
    !Number.isInteger(size) ||
    size < MIN_CHUNK_MAX_CHARS
  ) {
    throw new UsageError(
      `--chunk-max-chars must be an integer >= ${MIN_CHUNK_MAX_CHARS}`,
    );
  }

  const rawUsd = values['max-usd'] as string | undefined;
  let maxUsd = DEFAULT_REINDEX_MAX_USD;
  if (rawUsd !== undefined) {
    maxUsd = Number(rawUsd);
    if (rawUsd.trim() === '' || !Number.isFinite(maxUsd) || maxUsd <= 0) {
      throw new UsageError('--max-usd must be a positive number');
    }
  }

  return { cvMaxChars: size, dryRun: values['dry-run'] === true, maxUsd };
}

/**
 * The database name of `databaseUrl`, or `UsageError` unless it is an
 * experiment copy (`rag_ats_exp_<something>`). Checked before any connection,
 * so the dev and seeded databases can never be rewritten.
 */
export function assertExperimentDb(databaseUrl: string): string {
  let name: string;
  try {
    const url = new URL(databaseUrl);
    name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new UsageError('DATABASE_URL is not a valid URL');
  }
  if (!/^rag_ats_exp_[A-Za-z0-9_]+$/.test(name)) {
    throw new UsageError(
      `reindex only rewrites experiment databases (${EXPERIMENT_DB_PREFIX}*), not "${name}"`,
    );
  }
  return name;
}
