import type { PersonaSpec, VacancySpec } from '../synth/types.js';

/** Where a persona's files live, relative to the synthetic data directory. */
export const pdfPath = (personaId: string): string => `pdf/${personaId}.pdf`;
export const githubFixturePath = (username: string): string =>
  `github/${username}.json`;
export const githubUrl = (username: string): string =>
  `https://github.com/${username}`;

export const pairKey = (personaId: string, vacancyId: string): string =>
  `${personaId}\u0000${vacancyId}`;

/**
 * What the DB already holds (empty on a fresh DB and in a dry run), so a re-run
 * only plans the missing work.
 */
export interface SeedState {
  /** Persona ids whose candidate is already `parsed`. */
  parsedPersonaIds: ReadonlySet<string>;
  /** `pairKey`s of applications that already exist. */
  appliedPairs: ReadonlySet<string>;
  /** Vacancy ids whose criteria are already extracted. */
  vacanciesWithCriteria: ReadonlySet<string>;
}

export const EMPTY_STATE: SeedState = {
  parsedPersonaIds: new Set(),
  appliedPairs: new Set(),
  vacanciesWithCriteria: new Set(),
};

export interface PersonaPlan {
  persona: PersonaSpec;
  /** Vacancy ids still to apply to, in `applyTo` order (the first one carries the parse). */
  apply: string[];
  /** Vacancy ids already applied to. */
  alreadyApplied: string[];
  /** True when the first application will trigger a (paid) CV parse. */
  needsParse: boolean;
}

export interface WorkCounts {
  personas: number;
  applications: number;
  parses: number;
  embeddings: number;
  criteriaExtractions: number;
  scores: number;
}

export interface SeedPlan {
  items: PersonaPlan[];
  /** Vacancy ids that need to exist (referenced by a planned application). */
  vacancyIds: string[];
  /** Vacancy ids that still need their criteria extracted. */
  criteriaVacancyIds: string[];
  counts: WorkCounts;
}

/**
 * Every file the seed reads for these personas, as paths relative to the data
 * directory: the PDF always, the GitHub fixture when the persona has a GitHub
 * account. Personas without applications are never submitted, so need nothing.
 */
export function requiredFiles(personas: PersonaSpec[]): string[] {
  const files: string[] = [];
  for (const persona of personas) {
    if (persona.applyTo.length === 0) continue;
    files.push(pdfPath(persona.id));
    if (persona.github) files.push(githubFixturePath(persona.github.username));
  }
  return files;
}

/**
 * Problems that make the seed unrunnable, all listed at once: unknown persona
 * or vacancy ids, and every missing file.
 */
export function validateInputs(
  personas: PersonaSpec[],
  vacancies: VacancySpec[],
  hasFile: (relativePath: string) => boolean,
): string[] {
  const errors: string[] = [];
  const vacancyIds = new Set(vacancies.map((v) => v.id));

  const unknown = new Set<string>();
  for (const persona of personas) {
    for (const id of persona.applyTo) {
      if (!vacancyIds.has(id)) unknown.add(`${persona.id} -> ${id}`);
    }
  }
  if (unknown.size > 0) {
    errors.push(
      `Unknown vacancy ids in applyTo (persona -> vacancy): ${[...unknown].join(', ')}`,
    );
  }

  const missing = requiredFiles(personas).filter((file) => !hasFile(file));
  if (missing.length > 0) {
    errors.push(
      `Missing ${missing.length} file(s):\n  ${missing.join('\n  ')}`,
    );
  }
  return errors;
}

/**
 * Orders the work: per persona (file order), the first application first (it
 * carries the one parse), then the rest (they reuse the parsed CV). Pairs that
 * already exist are skipped. Assumes `validateInputs` passed.
 */
export function buildPlan(
  personas: PersonaSpec[],
  vacancies: VacancySpec[],
  state: SeedState = EMPTY_STATE,
): SeedPlan {
  const known = new Set(vacancies.map((v) => v.id));
  const items: PersonaPlan[] = [];
  for (const persona of personas) {
    const ordered = [...new Set(persona.applyTo)].filter((id) => known.has(id));
    const apply = ordered.filter(
      (id) => !state.appliedPairs.has(pairKey(persona.id, id)),
    );
    if (apply.length === 0) continue;
    items.push({
      persona,
      apply,
      alreadyApplied: ordered.filter((id) => !apply.includes(id)),
      needsParse: !state.parsedPersonaIds.has(persona.id),
    });
  }

  const vacancyIds = [...new Set(items.flatMap((i) => i.apply))];
  const criteriaVacancyIds = vacancyIds.filter(
    (id) => !state.vacanciesWithCriteria.has(id),
  );
  const parses = items.filter((i) => i.needsParse).length;
  return {
    items,
    vacancyIds,
    criteriaVacancyIds,
    counts: {
      personas: items.length,
      applications: items.reduce((n, i) => n + i.apply.length, 0),
      parses,
      embeddings: parses,
      criteriaExtractions: criteriaVacancyIds.length,
      scores: items.reduce((n, i) => n + i.apply.length, 0),
    },
  };
}
