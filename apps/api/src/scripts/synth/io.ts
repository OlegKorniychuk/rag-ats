/** Reading and writing the files under data/synthetic/. */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import type {
  GroundTruth,
  PersonaSpec,
  SearchQuery,
  Taxonomy,
  VacancySpec,
} from './types.js';

// src|dist/scripts/synth/io.js -> repo root is five levels up.
export const SYNTH_DIR = fileURLToPath(
  new URL('../../../../../data/synthetic/', import.meta.url),
);

export interface PersonasFile {
  /** The seed that passed the distribution guard (may exceed the one asked for). */
  seed: number;
  personas: PersonaSpec[];
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    throw new Error(
      `Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Written through prettier, so `prettier --check` never flags generated data. */
export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await format(JSON.stringify(data), { parser: 'json' }));
}

export const loadTaxonomy = (dir: string): Promise<Taxonomy> =>
  readJson<Taxonomy>(join(dir, 'taxonomy.json'));

/** vacancies.json (LLM prose) when present, otherwise the hand-written draft. */
export async function loadVacancies(dir: string): Promise<VacancySpec[]> {
  const final = join(dir, 'vacancies.json');
  const path = (await exists(final))
    ? final
    : join(dir, 'vacancies.draft.json');
  const data = await readJson<VacancySpec[] | { vacancies: VacancySpec[] }>(
    path,
  );
  return Array.isArray(data) ? data : data.vacancies;
}

export const loadPersonas = (dir: string): Promise<PersonasFile> =>
  readJson<PersonasFile>(join(dir, 'personas.json'));

export const loadQueries = (dir: string): Promise<SearchQuery[]> =>
  readJson<SearchQuery[]>(join(dir, 'queries.json'));

export const writeGroundTruth = (dir: string, gt: GroundTruth): Promise<void> =>
  writeJson(join(dir, 'ground-truth.json'), gt);
