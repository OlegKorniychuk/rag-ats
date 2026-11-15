import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ConflictException,
  type INestApplicationContext,
} from '@nestjs/common';
import type { ParseStatus } from '@rag-ats/shared';
import { ClsService } from 'nestjs-cls';
import type { Pool } from 'pg';
import { ApplyService } from '../../apply/apply.service.js';
import type { SubmitApplicationDto } from '../../apply/dto/submit-application.dto.js';
import { AuthService } from '../../auth/auth.service.js';
import { DRIZZLE, type AppDatabase } from '../../db/db.tokens.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';
import { VacanciesService } from '../../vacancies/vacancies.service.js';
import type { PersonaSpec, VacancySpec } from '../synth/types.js';
import { canSubmit, queuedEstimateUsd } from './budget.js';
import {
  criteriaEstimateUsd,
  MARGIN,
  UNIT_COST_USD,
  personaEstimateUsd,
} from './estimator.js';
import type { SeedMeter } from './metering.js';
import {
  buildPlan,
  githubUrl,
  pairKey,
  pdfPath,
  type PersonaPlan,
  type SeedState,
} from './planner.js';
import type { StopReason, SubmitError } from './report.js';
import {
  isDrained,
  progressLine,
  queuedWork,
  summarize,
  type CandidateRow,
  type ScoreRow,
  type SeedSnapshot,
} from './snapshot.js';

export const SEED_RECRUITER_EMAIL = 'seed@example.com';
/** Used when `SEED_RECRUITER_PASSWORD` is unset: a local dev account only. */
export const DEFAULT_SEED_PASSWORD = 'seed-recruiter-dev';

const CRITERIA_WAIT_MS = 3 * 60_000;

export interface RunSeedOptions {
  /** Absolute synthetic data directory (the PDFs are read from `<dir>/pdf`). */
  dir: string;
  /** Personas to seed (already filtered by `--only`). */
  personas: PersonaSpec[];
  vacancies: VacancySpec[];
  recruiterEmail?: string;
  recruiterPassword?: string;
  maxUsd: number;
  timeoutMs: number;
  /** Personas applying at once. */
  concurrency: number;
  meter: SeedMeter;
  pollMs?: number;
  log?: (line: string) => void;
}

export interface RunSeedResult {
  stopped: StopReason;
  snapshot: SeedSnapshot;
  submitErrors: SubmitError[];
  /** Personas whose remaining applications were not submitted (parse failed). */
  skippedPersonaIds: string[];
  durationMs: number;
}

interface SeedVacancy {
  id: string;
  applyToken: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs async tasks one at a time, in order. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

/**
 * The seed core, on a running app context: ensure the recruiter and the
 * vacancies, extract criteria, submit the applications through `ApplyService`,
 * then wait for the background jobs to settle. Nothing here prints secrets.
 */
export async function runSeed(
  app: INestApplicationContext,
  options: RunSeedOptions,
): Promise<RunSeedResult> {
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;
  const pollMs = options.pollMs ?? 1000;
  const log = options.log ?? (() => undefined);
  const { meter, maxUsd } = options;

  const db = app.get<AppDatabase>(DRIZZLE);
  const pool = (db as AppDatabase & { $client: Pool }).$client;
  const cls = app.get(ClsService);
  const auth = app.get(AuthService);
  const vacanciesService = app.get(VacanciesService);
  const applyService = app.get(ApplyService);
  const jobs = app.get(JobsService);

  const submitErrors: SubmitError[] = [];
  const skippedPersonaIds: string[] = [];
  let stopped: StopReason = null;
  const timedOut = () => Date.now() > deadline;
  const halted = () => stopped !== null;

  // 1. recruiter -------------------------------------------------------------
  const recruiterEmail = options.recruiterEmail ?? SEED_RECRUITER_EMAIL;
  let recruiterId: string;
  const found = await pool.query<{ id: string }>(
    'SELECT id FROM recruiters WHERE email = $1',
    [recruiterEmail],
  );
  if (found.rows[0]) {
    recruiterId = found.rows[0].id;
    log(`Recruiter ${recruiterEmail}: exists`);
  } else {
    const created = await cls.run(() =>
      auth.register({
        email: recruiterEmail,
        password: options.recruiterPassword ?? DEFAULT_SEED_PASSWORD,
      }),
    );
    recruiterId = created.id;
    log(`Recruiter ${recruiterEmail}: created`);
  }

  // 2. vacancies (skipped by title) -------------------------------------------
  const referenced = new Set(options.personas.flatMap((p) => p.applyTo));
  const specs = options.vacancies.filter((v) => referenced.has(v.id));
  const vacancyRows = await pool.query<{
    id: string;
    title: string;
    apply_token: string;
  }>(
    'SELECT id, title, apply_token FROM vacancies WHERE recruiter_id = $1 AND title = ANY($2) ORDER BY created_at',
    [recruiterId, specs.map((v) => v.title)],
  );
  const bySpec = new Map<string, SeedVacancy>();
  let createdVacancies = 0;
  for (const spec of specs) {
    const existing = vacancyRows.rows.find((r) => r.title === spec.title);
    if (existing) {
      bySpec.set(spec.id, {
        id: existing.id,
        applyToken: existing.apply_token,
      });
      continue;
    }
    const vacancy = await cls.run(() =>
      vacanciesService.create(recruiterId, {
        title: spec.title,
        requirements: spec.text,
      }),
    );
    bySpec.set(spec.id, { id: vacancy.id, applyToken: vacancy.applyToken });
    createdVacancies += 1;
  }
  log(
    `Vacancies: ${createdVacancies} created, ${specs.length - createdVacancies} already there`,
  );

  // 3. current state -> plan --------------------------------------------------
  const emails = options.personas.map((p) => p.email.toLowerCase());
  const personaByEmail = new Map(
    options.personas.map((p) => [p.email.toLowerCase(), p] as const),
  );
  const specByVacancyId = new Map(
    [...bySpec.entries()].map(([specId, v]) => [v.id, specId] as const),
  );

  const stateRows = await pool.query<{
    email: string;
    parse_status: ParseStatus;
  }>('SELECT email, parse_status FROM candidates WHERE email = ANY($1)', [
    emails,
  ]);
  const applied = await pool.query<{ email: string; vacancy_id: string }>(
    `SELECT c.email, a.vacancy_id
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN vacancies v ON v.id = a.vacancy_id
      WHERE c.email = ANY($1) AND v.recruiter_id = $2`,
    [emails, recruiterId],
  );
  const criteriaRows = await pool.query<{
    id: string;
    title: string;
    requirements: string;
    criteria_hash: string | null;
  }>(
    'SELECT id, title, requirements, criteria_hash FROM vacancies WHERE recruiter_id = $1 AND id = ANY($2)',
    [recruiterId, [...bySpec.values()].map((v) => v.id)],
  );
  const state: SeedState = {
    parsedPersonaIds: new Set(
      stateRows.rows
        .filter((r) => r.parse_status === 'parsed')
        .map((r) => personaByEmail.get(r.email)?.id)
        .filter((id): id is string => !!id),
    ),
    appliedPairs: new Set(
      applied.rows
        .map((r) => {
          const persona = personaByEmail.get(r.email);
          const specId = specByVacancyId.get(r.vacancy_id);
          return persona && specId ? pairKey(persona.id, specId) : null;
        })
        .filter((k): k is string => k !== null),
    ),
    vacanciesWithCriteria: new Set(
      criteriaRows.rows
        .filter(
          (r) =>
            r.criteria_hash === vacancyCriteriaHash(r.title, r.requirements),
        )
        .map((r) => specByVacancyId.get(r.id))
        .filter((id): id is string => !!id),
    ),
  };
  const plan = buildPlan(options.personas, options.vacancies, state);
  log(
    `Plan: ${plan.counts.applications} application(s) for ${plan.counts.personas} persona(s), ${plan.counts.parses} parse(s), ${plan.counts.criteriaExtractions} criteria extraction(s)`,
  );

  // snapshot of the seeded rows (drain, budget, report) -------------------------
  const takeSnapshot = async (): Promise<SeedSnapshot> => {
    const candidates = await pool.query<{
      id: string;
      email: string;
      parse_status: ParseStatus;
      parse_error: string | null;
      parsed_cv_document_id: string | null;
      embedded_cv_document_id: string | null;
    }>(
      `SELECT id, email, parse_status, parse_error, parsed_cv_document_id, embedded_cv_document_id
         FROM candidates WHERE email = ANY($1) ORDER BY email`,
      [emails],
    );
    const scores = await pool.query<{
      application_id: string;
      candidate_id: string;
      title: string;
      status: ScoreRow['status'];
      error: string | null;
    }>(
      `SELECT s.application_id, a.candidate_id, v.title, s.status, s.error
         FROM application_scores s
         JOIN applications a ON a.id = s.application_id
         JOIN vacancies v ON v.id = a.vacancy_id
         JOIN candidates c ON c.id = a.candidate_id
        WHERE c.email = ANY($1) AND v.recruiter_id = $2
        ORDER BY c.email, v.title`,
      [emails, recruiterId],
    );
    return {
      candidates: candidates.rows.map((r): CandidateRow => ({
        id: r.id,
        email: r.email,
        parseStatus: r.parse_status,
        parseError: r.parse_error,
        parsedCvDocumentId: r.parsed_cv_document_id,
        embeddedCvDocumentId: r.embedded_cv_document_id,
      })),
      scores: scores.rows.map((r): ScoreRow => ({
        applicationId: r.application_id,
        candidateId: r.candidate_id,
        vacancyTitle: r.title,
        status: r.status,
        error: r.error,
      })),
    };
  };

  const queuedUsd = async (): Promise<number> =>
    queuedEstimateUsd(queuedWork(await takeSnapshot()), UNIT_COST_USD, MARGIN);

  // 4. criteria extraction -----------------------------------------------------
  const criteriaIds: string[] = [];
  for (const specId of plan.criteriaVacancyIds) {
    const vacancy = bySpec.get(specId)!;
    if (
      !canSubmit(
        meter.spentUsd,
        criteriaIds.length * criteriaEstimateUsd(),
        criteriaEstimateUsd(),
        maxUsd,
      )
    ) {
      stopped = 'budget';
      log('Budget cap reached before the criteria extractions finished');
      break;
    }
    await jobs.enqueueCriteria(vacancy.id);
    criteriaIds.push(vacancy.id);
  }
  if (criteriaIds.length > 0) {
    log(`Extracting criteria for ${criteriaIds.length} vacancy(ies)`);
    const waitUntil = Math.min(deadline, Date.now() + CRITERIA_WAIT_MS);
    for (;;) {
      const rows = await pool.query<{
        title: string;
        requirements: string;
        criteria_hash: string | null;
      }>(
        'SELECT title, requirements, criteria_hash FROM vacancies WHERE id = ANY($1)',
        [criteriaIds],
      );
      const missing = rows.rows.filter(
        (r) => r.criteria_hash !== vacancyCriteriaHash(r.title, r.requirements),
      ).length;
      if (missing === 0) break;
      if (Date.now() > waitUntil) {
        log(
          `Criteria for ${missing} vacancy(ies) not ready; scoring will extract them on demand`,
        );
        break;
      }
      await sleep(pollMs);
    }
  }

  // 5. applications ------------------------------------------------------------
  const submitLock = new Mutex();
  let submitted = 0;

  /** Waits until the candidate's parse settled; null when nothing is left to wait for. */
  const waitParseSettled = async (
    email: string,
  ): Promise<'none' | 'parsed' | 'failed' | 'stop'> => {
    for (;;) {
      const row = await pool.query<{ parse_status: ParseStatus }>(
        'SELECT parse_status FROM candidates WHERE email = $1',
        [email],
      );
      const status = row.rows[0]?.parse_status;
      if (!status) return 'none';
      if (status === 'parsed' || status === 'failed') return status;
      if (halted() || timedOut()) return 'stop';
      await sleep(pollMs);
    }
  };

  const applyPersona = async (item: PersonaPlan): Promise<void> => {
    const { persona } = item;
    const email = persona.email.toLowerCase();
    const buffer = await readFile(join(options.dir, pdfPath(persona.id))).catch(
      (err: unknown) => {
        submitErrors.push({
          personaId: persona.id,
          vacancyId: item.apply[0],
          message: `Cannot read ${pdfPath(persona.id)}: ${err instanceof Error ? err.message : String(err)}`,
        });
        return null;
      },
    );
    if (!buffer) return;
    const file = {
      fieldname: 'cv',
      originalname: `${persona.id}.pdf`,
      mimetype: 'application/pdf',
      buffer,
      size: buffer.length,
    } as Express.Multer.File;
    const dto: SubmitApplicationDto = {
      name: persona.name,
      email,
      ...(persona.github && { githubUrl: githubUrl(persona.github.username) }),
    };

    for (const [index, vacancyId] of item.apply.entries()) {
      if (halted() || timedOut()) return;
      // A second application re-parses unless the first parse finished (the
      // CV is only reused for a `parsed` candidate), so settle it first.
      const settled = await waitParseSettled(email);
      if (settled === 'stop') return;
      if (settled === 'failed') {
        log(
          `${persona.id}: parse failed, not applying to the remaining vacancies`,
        );
        skippedPersonaIds.push(persona.id);
        return;
      }

      const vacancy = bySpec.get(vacancyId)!;
      await submitLock.run(async () => {
        if (halted() || timedOut()) return;
        const next = personaEstimateUsd(1, settled === 'none');
        if (!canSubmit(meter.spentUsd, await queuedUsd(), next, maxUsd)) {
          stopped = 'budget';
          log(
            `Budget cap $${maxUsd.toFixed(2)} reached (spent $${meter.spentUsd.toFixed(4)}); no more submissions`,
          );
          return;
        }
        try {
          await cls.run(() =>
            applyService.submit(vacancy.applyToken, dto, file),
          );
          submitted += 1;
          log(
            `[submit ${submitted}/${plan.counts.applications}] ${persona.id} -> ${vacancyId} (${index + 1}/${item.apply.length})`,
          );
        } catch (err) {
          if (
            err instanceof ConflictException &&
            /already applied/i.test(err.message)
          ) {
            log(`${persona.id} -> ${vacancyId}: already applied`);
            return;
          }
          submitErrors.push({
            personaId: persona.id,
            vacancyId,
            message: err instanceof Error ? err.message : String(err),
          });
          log(`${persona.id} -> ${vacancyId}: submit failed`);
        }
      });
    }
  };

  await runPool(plan.items, options.concurrency, applyPersona);

  // 6. drain ------------------------------------------------------------------
  let snapshot = await takeSnapshot();
  let lastLine = '';
  while (!isDrained(snapshot)) {
    if (timedOut()) {
      stopped ??= 'timeout';
      log('Timed out waiting for the background jobs');
      break;
    }
    const line = progressLine(summarize(snapshot));
    if (line !== lastLine) {
      log(`[drain] ${line}`);
      lastLine = line;
    }
    await sleep(pollMs);
    snapshot = await takeSnapshot();
  }
  if (timedOut() && !isDrained(snapshot)) stopped ??= 'timeout';
  log(`[done] ${progressLine(summarize(snapshot))}`);

  return {
    stopped,
    snapshot,
    submitErrors,
    skippedPersonaIds,
    durationMs: Date.now() - startedAt,
  };
}
