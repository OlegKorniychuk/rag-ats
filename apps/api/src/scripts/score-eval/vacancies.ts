import { readFile } from 'node:fs/promises';

export const BANDS = ['strong', 'partial', 'weak'] as const;

/** strong: overall >= 75, partial: 40-74, weak: < 40. */
export type Band = (typeof BANDS)[number];

export interface EvalVacancy {
  id: string;
  title: string;
  requirements: string;
  notes: string;
  /** Expected band per Checkpoint A CV id; only clear-cut pairs are listed. */
  expect: Record<string, Band>;
  /** Keywords that must each appear in some extracted criterion (optional). */
  mustCoverTerms?: string[];
}

export interface VacancySet {
  description: string;
  vacancies: EvalVacancy[];
}

export class VacancySetError extends Error {
  constructor(message: string) {
    super(`Invalid vacancy set: ${message}`);
    this.name = 'VacancySetError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new VacancySetError(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function parseExpect(
  raw: unknown,
  where: string,
  knownCvIds: ReadonlySet<string>,
): Record<string, Band> {
  if (!isRecord(raw)) throw new VacancySetError(`${where} must be an object`);
  const out: Record<string, Band> = {};
  for (const [cvId, band] of Object.entries(raw)) {
    if (!knownCvIds.has(cvId)) {
      throw new VacancySetError(`${where} has unknown CV id "${cvId}"`);
    }
    if (
      typeof band !== 'string' ||
      !(BANDS as readonly string[]).includes(band)
    ) {
      throw new VacancySetError(
        `${where}["${cvId}"] must be one of ${BANDS.join(', ')} (got ${JSON.stringify(band)})`,
      );
    }
    out[cvId] = band as Band;
  }
  return out;
}

/**
 * Validates the vacancy set shape; throws `VacancySetError` with a clear
 * message. `knownCvIds` are the CV ids of the Checkpoint A manifest.
 */
export function parseVacancySet(
  raw: unknown,
  knownCvIds: Iterable<string>,
): VacancySet {
  if (!isRecord(raw) || !Array.isArray(raw.vacancies)) {
    throw new VacancySetError('expected an object with a "vacancies" array');
  }
  if (raw.vacancies.length === 0) {
    throw new VacancySetError('"vacancies" must not be empty');
  }
  const description = raw.description ?? '';
  if (typeof description !== 'string') {
    throw new VacancySetError('"description" must be a string');
  }
  const known = new Set(knownCvIds);

  const seen = new Set<string>();
  const vacancies = raw.vacancies.map(
    (entry: unknown, index: number): EvalVacancy => {
      const where = `vacancies[${index}]`;
      if (!isRecord(entry)) {
        throw new VacancySetError(`${where} must be an object`);
      }

      const id = requireString(entry, 'id', where);
      if (seen.has(id)) throw new VacancySetError(`duplicate id "${id}"`);
      seen.add(id);

      const notes = entry.notes ?? '';
      if (typeof notes !== 'string') {
        throw new VacancySetError(`${where}.notes must be a string`);
      }

      const vacancy: EvalVacancy = {
        id,
        title: requireString(entry, 'title', where),
        requirements: requireString(entry, 'requirements', where),
        notes,
        expect: parseExpect(entry.expect ?? {}, `${where}.expect`, known),
      };

      if (entry.mustCoverTerms !== undefined) {
        const terms = entry.mustCoverTerms;
        if (
          !Array.isArray(terms) ||
          !terms.every((t) => typeof t === 'string' && t.trim() !== '')
        ) {
          throw new VacancySetError(
            `${where}.mustCoverTerms must be an array of non-empty strings`,
          );
        }
        vacancy.mustCoverTerms = terms as string[];
      }
      return vacancy;
    },
  );

  return { description, vacancies };
}

export async function loadVacancySet(
  path: string,
  knownCvIds: Iterable<string>,
): Promise<VacancySet> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new VacancySetError(`cannot read ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new VacancySetError(`${path} is not valid JSON`);
  }
  return parseVacancySet(json, knownCvIds);
}
