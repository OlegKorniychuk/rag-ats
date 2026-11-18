/**
 * Where the eval writes, and the small files around the score cache. For a
 * label `L` under the baseline directory:
 *
 *   L/retrieval.json   raw `RetrievalResult` of the last retrieval run
 *   L/scores.jsonl     the scoring cache (one line per pair x mode x run)
 *   L/run-log.json     one entry per live invocation
 *   L/review-<mode>.md the citation review stub (filled in by hand)
 *   L.json, L.md       the aggregate, re-rendered on every invocation
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import type { EvalPart } from './args.js';
import type { RetrievalResult } from './retrieval.js';
import type { ScoringMode } from './score-record.js';

/** Repo-relative home of the reports. */
export const BASELINE_DIR = 'docs/eval/baseline';

export interface BaselinePaths {
  /** `<baseline>/<label>` */
  dir: string;
  retrieval: string;
  scores: string;
  runLog: string;
  aggregateJson: string;
  aggregateMd: string;
  review(mode: ScoringMode): string;
}

export function baselinePaths(
  baselineDir: string,
  label: string,
): BaselinePaths {
  const dir = join(baselineDir, label);
  return {
    dir,
    retrieval: join(dir, 'retrieval.json'),
    scores: join(dir, 'scores.jsonl'),
    runLog: join(dir, 'run-log.json'),
    aggregateJson: join(baselineDir, `${label}.json`),
    aggregateMd: join(baselineDir, `${label}.md`),
    review: (mode) => join(dir, `review-${mode}.md`),
  };
}

/** One live invocation (dry runs, report-only and review commands write none). */
export interface RunLogEntry {
  part: EvalPart;
  startedAt: string;
  finishedAt: string;
  /** Scoring modes of the invocation (empty for a retrieval-only run). */
  modes: ScoringMode[];
  seed: number;
  weak: number;
  noise: number;
  limit: number | null;
  concurrency: number;
  maxUsd: number;
  retryFailed: boolean;
  /** USD the meter saw during the invocation (chat and embeddings). */
  spentUsd: number;
  /** `budget` when the cap stopped scores from starting. */
  stopped: 'budget' | null;
  scoring: {
    planned: number;
    done: number;
    failed: number;
    skipped: number;
    notStarted: number;
  } | null;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Formats with prettier (and the repo's config), so `prettier --check` never flags a generated file. */
export async function formatText(
  path: string,
  text: string,
  parser: 'markdown' | 'json',
): Promise<string> {
  const config = (await resolveConfig(path)) ?? {};
  return format(text, { ...config, parser });
}

/** Writes a generated file through prettier; creates the directory. */
export async function writeFormatted(
  path: string,
  text: string,
  parser: 'markdown' | 'json',
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await formatText(path, text, parser));
}

export const writeJson = (path: string, value: unknown): Promise<void> =>
  writeFormatted(path, JSON.stringify(value, null, 2), 'json');

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  const text = await readIfExists(path);
  return text === null ? null : (JSON.parse(text) as T);
}

export const readRetrieval = (
  paths: BaselinePaths,
): Promise<RetrievalResult | null> =>
  readJsonIfExists<RetrievalResult>(paths.retrieval);

export const writeRetrieval = (
  paths: BaselinePaths,
  result: RetrievalResult,
): Promise<void> => writeJson(paths.retrieval, result);

export async function readRunLog(paths: BaselinePaths): Promise<RunLogEntry[]> {
  return (await readJsonIfExists<RunLogEntry[]>(paths.runLog)) ?? [];
}

export async function appendRunLog(
  paths: BaselinePaths,
  entry: RunLogEntry,
): Promise<void> {
  await writeJson(paths.runLog, [...(await readRunLog(paths)), entry]);
}

export const readText = readIfExists;
