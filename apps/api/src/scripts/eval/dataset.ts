/**
 * Reads the seeded database for the eval (read-only: lookups through the
 * existing repository methods, nothing is written) and checks it against the
 * synthetic set.
 */
import type { INestApplicationContext } from '@nestjs/common';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../../db/repositories/candidates.repository.js';
import {
  RECRUITERS_REPOSITORY,
  type RecruitersRepository,
} from '../../db/repositories/recruiters.repository.js';
import {
  VACANCIES_REPOSITORY,
  type VacanciesRepository,
} from '../../db/repositories/vacancies.repository.js';
import { SEED_RECRUITER_EMAIL } from '../seed/run.js';
import type { SyntheticSet } from './data.js';
import {
  buildEvalDataset,
  findPreflightProblems,
  personaEmailKey,
  PreflightError,
  type CandidateDbState,
  type DbState,
  type EvalDataset,
  type VacancyDbState,
} from './preflight.js';

export interface DatasetOptions {
  /** The recruiter who owns the seeded vacancies. */
  recruiterEmail?: string;
}

/**
 * What the seeded database holds for the personas and vacancies of `set`.
 * Only the personas and vacancies in `set` are looked up, so a subset of the
 * synthetic data (the integration test's mini set) is checked as it is.
 */
export async function readDbState(
  app: INestApplicationContext,
  set: SyntheticSet,
  options: DatasetOptions = {},
): Promise<DbState> {
  const candidates = app.get<CandidatesRepository>(CANDIDATES_REPOSITORY);
  const recruiters = app.get<RecruitersRepository>(RECRUITERS_REPOSITORY);
  const vacancies = app.get<VacanciesRepository>(VACANCIES_REPOSITORY);
  const recruiterEmail = options.recruiterEmail ?? SEED_RECRUITER_EMAIL;

  const candidatesByEmail = new Map<string, CandidateDbState | null>();
  await Promise.all(
    set.personas.map(async (persona) => {
      const email = personaEmailKey(persona);
      const candidate = await candidates.findByEmail(email);
      if (!candidate) {
        candidatesByEmail.set(email, null);
        return;
      }
      const parse = await candidates.findParseState(candidate.id);
      const embed = await candidates.findEmbedState(candidate.id);
      candidatesByEmail.set(email, {
        candidateId: candidate.id,
        parseStatus: candidate.parseStatus,
        parsedCvDocumentId: embed?.parsedCvDocumentId ?? null,
        latestCvDocumentId: parse?.latestCvDocumentId ?? null,
        embeddedCvDocumentId: embed?.embeddedCvDocumentId ?? null,
      });
    }),
  );

  const recruiter = await recruiters.findByEmail(recruiterEmail);
  const vacanciesByTitle = new Map<string, VacancyDbState[]>();
  if (recruiter) {
    const titles = new Set(set.vacancies.map((v) => v.title));
    const owned = await vacancies.findByRecruiterId(recruiter.id);
    for (const vacancy of owned) {
      if (!titles.has(vacancy.title)) continue;
      const stored = await vacancies.findCriteria(vacancy.id);
      if (!stored) continue;
      const rows = vacanciesByTitle.get(vacancy.title) ?? [];
      rows.push({
        id: vacancy.id,
        title: stored.title,
        requirements: stored.requirements,
        criteria: stored.criteria,
        criteriaHash: stored.criteriaHash,
      });
      vacanciesByTitle.set(vacancy.title, rows);
    }
  }

  return {
    recruiterEmail,
    recruiterFound: recruiter !== null,
    candidatesByEmail,
    vacanciesByTitle,
  };
}

export interface PreflightResult {
  /** Empty when the eval can start. */
  problems: string[];
  dbState: DbState;
}

/** Runs the checks and returns the full list of problems (does not throw). */
export async function preflight(
  app: INestApplicationContext,
  set: SyntheticSet,
  options: DatasetOptions = {},
): Promise<PreflightResult> {
  const dbState = await readDbState(app, set, options);
  return { problems: findPreflightProblems(set, dbState), dbState };
}

/** Preflight, then the dataset; throws `PreflightError` listing every problem. */
export async function loadEvalDataset(
  app: INestApplicationContext,
  set: SyntheticSet,
  options: DatasetOptions = {},
): Promise<EvalDataset> {
  const { problems, dbState } = await preflight(app, set, options);
  if (problems.length > 0) throw new PreflightError(problems);
  return buildEvalDataset(set, dbState);
}
