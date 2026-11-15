import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fromRoot, UsageError } from '../shared/cli.js';
import type { PersonaSpec, VacancySpec } from '../synth/types.js';
import { requiredFiles } from './planner.js';

async function readJson<T>(path: string, what: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    throw new UsageError(
      missing
        ? `${what} not found: ${path}`
        : `Cannot read ${what} (${path}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function loadPersonas(dir: string): Promise<PersonaSpec[]> {
  const file = await readJson<{ personas: PersonaSpec[] }>(
    join(dir, 'personas.json'),
    'personas.json (run `synth personas` first)',
  );
  return file.personas;
}

/**
 * The final vacancies file by default (the LLM-written prose); never silently
 * the draft. `--vacancies` points anywhere, e.g. at `vacancies.draft.json`.
 * Accepts a bare array or `{ vacancies: [...] }`.
 */
export async function loadVacancies(
  dir: string,
  vacanciesArg: string | null,
): Promise<VacancySpec[]> {
  const path = vacanciesArg
    ? isAbsolute(vacanciesArg)
      ? vacanciesArg
      : fromRoot(vacanciesArg)
    : join(dir, 'vacancies.json');
  const data = await readJson<VacancySpec[] | { vacancies: VacancySpec[] }>(
    path,
    vacanciesArg
      ? 'vacancies file'
      : 'vacancies.json (run `synth vacancies`, or pass --vacancies <path>)',
  );
  return Array.isArray(data) ? data : data.vacancies;
}

/** `--only`: the listed personas, in file order; unknown ids are a usage error. */
export function selectPersonas(
  personas: PersonaSpec[],
  only: string[] | null,
): PersonaSpec[] {
  if (!only) return personas;
  const known = new Set(personas.map((p) => p.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new UsageError(
      `--only: unknown persona id(s): ${unknown.join(', ')}`,
    );
  }
  const wanted = new Set(only);
  return personas.filter((p) => wanted.has(p.id));
}

/** The relative paths (of `requiredFiles`) that exist under `dir`. */
export async function existingFiles(
  dir: string,
  personas: PersonaSpec[],
): Promise<Set<string>> {
  const present = new Set<string>();
  await Promise.all(
    requiredFiles(personas).map(async (file) => {
      try {
        await access(join(dir, file));
        present.add(file);
      } catch {
        // missing: reported by validateInputs
      }
    }),
  );
  return present;
}
