/**
 * The scoring eval's resumable cache: a JSONL file, one `ScoreJobRecord` per
 * completed job, appended as each job finishes. Later lines win, so a retried
 * failure replaces the failed line for its key.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ScoreJob, ScoreJobRecord } from './score-record.js';
import { jobKey } from './score-record.js';

export interface ScoreCache {
  /** The newest record per job key. */
  byKey: Map<string, ScoreJobRecord>;
  /** Lines that were not a record (a truncated last line after a crash, say). */
  corruptLines: number;
}

function parseLine(line: string): ScoreJobRecord | null {
  try {
    const value: unknown = JSON.parse(line);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { key?: unknown }).key === 'string' &&
      ['ok', 'failed'].includes((value as { status?: string }).status ?? '')
    ) {
      return value as ScoreJobRecord;
    }
  } catch {
    // fall through: not JSON (truncated)
  }
  return null;
}

/** Reads the cache (a missing file is an empty cache). Never writes. */
export async function readScoreCache(path: string): Promise<ScoreCache> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { byKey: new Map(), corruptLines: 0 };
    }
    throw error;
  }
  const byKey = new Map<string, ScoreJobRecord>();
  let corruptLines = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const record = parseLine(line);
    if (record) byKey.set(record.key, record);
    else corruptLines++;
  }
  return { byKey, corruptLines };
}

/**
 * Makes the file ready for appends: creates its directory and, if the last
 * line was cut off (no trailing newline), ends it so the next record starts on
 * its own line.
 */
export async function prepareScoreCache(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (text !== '' && !text.endsWith('\n')) await appendFile(path, '\n');
}

/**
 * One whole line per call, in a single append: concurrent calls from one
 * process do not interleave within a line.
 */
export async function appendScoreRecord(
  path: string,
  record: ScoreJobRecord,
): Promise<void> {
  await appendFile(path, `${JSON.stringify(record)}\n`);
}

export interface JobPartition {
  /** Records reused from the cache (ok ones, and failed ones unless retrying). */
  cached: ScoreJobRecord[];
  /** Jobs to run, in job order. */
  toRun: ScoreJob[];
}

/** Skips jobs with a success line; skips failed ones too unless `retryFailed`. */
export function partitionJobs(
  jobs: readonly ScoreJob[],
  cache: ScoreCache,
  retryFailed: boolean,
): JobPartition {
  const cached: ScoreJobRecord[] = [];
  const toRun: ScoreJob[] = [];
  for (const job of jobs) {
    const record = cache.byKey.get(jobKey(job));
    if (record && (record.status === 'ok' || !retryFailed)) cached.push(record);
    else toRun.push(job);
  }
  return { cached, toRun };
}
