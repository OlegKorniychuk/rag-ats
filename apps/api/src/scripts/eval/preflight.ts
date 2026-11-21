/**
 * Pure part of the eval's preflight: what the seeded database holds (as read
 * by `dataset.ts`) against what the synthetic set says it should hold. No I/O.
 */
import type { ParseStatus, VacancyCriterion } from '@rag-ats/shared';
import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';
import { BANDS, missingLabels } from '../synth/spot-check.js';
import type {
  Band,
  GroundTruth,
  PersonaSpec,
  VacancySpec,
} from '../synth/types.js';
import type { SyntheticSet } from './data.js';

/** What the eval needs to know about a candidate row. */
export interface CandidateDbState {
  candidateId: string;
  parseStatus: ParseStatus;
  /** The CV the current profile was parsed from. */
  parsedCvDocumentId: string | null;
  /** The newest CV by `created_at`; null when the candidate has no CV row. */
  latestCvDocumentId: string | null;
  /** The parsed CV the current chunks were embedded from. */
  embeddedCvDocumentId: string | null;
}

/** A vacancy row with its stored criteria. */
export interface VacancyDbState {
  id: string;
  title: string;
  requirements: string;
  criteria: VacancyCriterion[] | null;
  criteriaHash: string | null;
}

export interface DbState {
  recruiterEmail: string;
  recruiterFound: boolean;
  /** Keyed by lower-cased email; null when no candidate has it. */
  candidatesByEmail: ReadonlyMap<string, CandidateDbState | null>;
  /** The recruiter's vacancies by title (a title may hold several rows). */
  vacanciesByTitle: ReadonlyMap<string, VacancyDbState[]>;
}

export const personaEmailKey = (persona: PersonaSpec): string =>
  persona.email.toLowerCase();

function candidateProblems(
  persona: PersonaSpec,
  state: CandidateDbState | null | undefined,
): string[] {
  const who = `persona ${persona.id} (${persona.email})`;
  if (!state) return [`${who}: no candidate with this email`];
  if (state.parseStatus !== 'parsed') {
    return [`${who}: parse status is "${state.parseStatus}", not "parsed"`];
  }
  if (!state.parsedCvDocumentId) {
    return [`${who}: parsed, but no parsed CV is recorded`];
  }
  const problems: string[] = [];
  if (
    state.latestCvDocumentId !== null &&
    state.latestCvDocumentId !== state.parsedCvDocumentId
  ) {
    problems.push(
      `${who}: the profile is parsed from an older CV than the current one`,
    );
  }
  if (state.embeddedCvDocumentId !== state.parsedCvDocumentId) {
    problems.push(`${who}: chunks are not embedded for the parsed CV`);
  }
  return problems;
}

function vacancyProblems(
  spec: VacancySpec,
  rows: readonly VacancyDbState[] | undefined,
  recruiterEmail: string,
): string[] {
  const who = `vacancy ${spec.id} ("${spec.title}")`;
  if (!rows || rows.length === 0) {
    return [`${who}: not found for recruiter ${recruiterEmail}`];
  }
  if (rows.length > 1) {
    return [
      `${who}: ${rows.length} vacancies share this title, cannot tell which is seeded`,
    ];
  }
  const [row] = rows;
  const problems: string[] = [];
  if (
    vacancyCriteriaHash(row.title, row.requirements) !==
    vacancyCriteriaHash(spec.title, spec.text)
  ) {
    problems.push(`${who}: the stored requirements differ from vacancies.json`);
  }
  if (!row.criteria || row.criteria.length === 0 || !row.criteriaHash) {
    problems.push(`${who}: no extracted criteria`);
  } else if (
    row.criteriaHash !== vacancyCriteriaHash(row.title, row.requirements)
  ) {
    problems.push(
      `${who}: the criteria are outdated (hash differs from the current title and requirements)`,
    );
  }
  return problems;
}

function referenceProblems(set: SyntheticSet): string[] {
  const personaIds = new Set(set.personas.map((p) => p.id));
  const vacancyIds = new Set(set.vacancies.map((v) => v.id));
  const problems: string[] = [];

  const emails = new Map<string, string>();
  for (const persona of set.personas) {
    const key = personaEmailKey(persona);
    const other = emails.get(key);
    if (other) {
      problems.push(
        `personas ${other} and ${persona.id} share the email ${persona.email}`,
      );
    }
    emails.set(key, persona.id);
  }

  const unknownPairs = (
    where: string,
    pairs: ReadonlyArray<{ vacancyId: string; personaId: string }>,
  ): void => {
    const unknownPersonas = new Set<string>();
    const unknownVacancies = new Set<string>();
    for (const pair of pairs) {
      if (!personaIds.has(pair.personaId)) unknownPersonas.add(pair.personaId);
      if (!vacancyIds.has(pair.vacancyId)) unknownVacancies.add(pair.vacancyId);
    }
    if (unknownPersonas.size > 0) {
      problems.push(
        `${where}: unknown persona id(s): ${[...unknownPersonas].join(', ')}`,
      );
    }
    if (unknownVacancies.size > 0) {
      problems.push(
        `${where}: unknown vacancy id(s): ${[...unknownVacancies].join(', ')}`,
      );
    }
  };
  unknownPairs('ground-truth.json', set.groundTruth.pairs);
  unknownPairs('spot-check/labels.json', set.spotCheckLabels);

  const unknownRelevant = new Set<string>();
  for (const query of set.queries) {
    for (const id of [
      ...(query.relevant ?? []),
      ...(query.partiallyRelevant ?? []),
    ]) {
      if (!personaIds.has(id)) unknownRelevant.add(id);
    }
  }
  if (unknownRelevant.size > 0) {
    problems.push(
      `queries.json: unknown persona id(s): ${[...unknownRelevant].join(', ')}`,
    );
  }

  const unlabelled = missingLabels(set.spotCheckLabels);
  if (unlabelled.length > 0) {
    problems.push(
      `spot-check/labels.json: no band for pair(s) ${unlabelled.join(', ')}`,
    );
  }
  return problems;
}

/**
 * Everything wrong with the seeded database, or the set itself, for this run.
 * Empty means the eval can start. The whole list is returned at once so one
 * run shows every missing piece.
 */
export function findPreflightProblems(
  set: SyntheticSet,
  db: DbState,
): string[] {
  const problems = referenceProblems(set);
  for (const persona of set.personas) {
    problems.push(
      ...candidateProblems(
        persona,
        db.candidatesByEmail.get(personaEmailKey(persona)),
      ),
    );
  }
  if (!db.recruiterFound) {
    problems.push(`seed recruiter ${db.recruiterEmail} not found`);
  } else {
    for (const spec of set.vacancies) {
      problems.push(
        ...vacancyProblems(
          spec,
          db.vacanciesByTitle.get(spec.title),
          db.recruiterEmail,
        ),
      );
    }
  }
  return problems;
}

/** Thrown when the preflight finds problems; `problems` is the full list. */
export class PreflightError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `Eval preflight failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'PreflightError';
  }
}

export interface EvalVacancy {
  spec: VacancySpec;
  /** The seeded vacancy row. */
  id: string;
  criteria: VacancyCriterion[];
  criteriaHash: string;
}

export interface SpotCheckLabel {
  pair: number;
  vacancyId: string;
  personaId: string;
  band: Band;
}

/** The checked inputs of every later eval step. */
export interface EvalDataset {
  taxonomy: SyntheticSet['taxonomy'];
  personas: PersonaSpec[];
  vacancies: EvalVacancy[];
  /** persona id -> seeded candidate id, and back. */
  candidateIdByPersonaId: ReadonlyMap<string, string>;
  personaIdByCandidateId: ReadonlyMap<string, string>;
  /** vacancy spec id -> seeded vacancy id, and back. */
  vacancyIdBySpecId: ReadonlyMap<string, string>;
  specIdByVacancyId: ReadonlyMap<string, string>;
  groundTruth: GroundTruth;
  queries: SyntheticSet['queries'];
  /** Dude's labelled pairs (unlabelled entries are a preflight problem). */
  spotCheck: SpotCheckLabel[];
}

/** Assembles the dataset. Call only when `findPreflightProblems` is empty. */
export function buildEvalDataset(set: SyntheticSet, db: DbState): EvalDataset {
  const candidateIdByPersonaId = new Map<string, string>();
  for (const persona of set.personas) {
    const state = db.candidatesByEmail.get(personaEmailKey(persona));
    if (!state) throw new Error(`No candidate for persona ${persona.id}`);
    candidateIdByPersonaId.set(persona.id, state.candidateId);
  }
  const vacancies = set.vacancies.map((spec): EvalVacancy => {
    const row = db.vacanciesByTitle.get(spec.title)?.[0];
    if (!row?.criteria || !row.criteriaHash) {
      throw new Error(`No criteria for vacancy ${spec.id}`);
    }
    return {
      spec,
      id: row.id,
      criteria: row.criteria,
      criteriaHash: row.criteriaHash,
    };
  });
  return {
    taxonomy: set.taxonomy,
    personas: set.personas,
    vacancies,
    candidateIdByPersonaId,
    personaIdByCandidateId: new Map(
      [...candidateIdByPersonaId].map(([persona, candidate]) => [
        candidate,
        persona,
      ]),
    ),
    vacancyIdBySpecId: new Map(vacancies.map((v) => [v.spec.id, v.id])),
    specIdByVacancyId: new Map(vacancies.map((v) => [v.id, v.spec.id])),
    groundTruth: set.groundTruth,
    queries: set.queries,
    spotCheck: set.spotCheckLabels
      .filter((l): l is typeof l & { band: Band } =>
        BANDS.includes(l.band as Band),
      )
      .map((l) => ({
        pair: l.pair,
        vacancyId: l.vacancyId,
        personaId: l.personaId,
        band: l.band,
      })),
  };
}
