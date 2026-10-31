import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { applications } from '../schema.js';
import { latestCvSummaryWith, withCv } from './cv-summary.mapper.js';
import { withGithub } from './github-summary.mapper.js';
import { toApplicationScore } from './score.mapper.js';
import { publicVacancyColumnsWith } from './vacancies.repository.js';
import type {
  NewApplication,
  Application,
  ApplicationWithCandidate,
  ApplicationWithVacancy,
  CandidateApplication,
  ApplicationsRepository,
} from './applications.repository.js';

@Injectable()
export class DrizzleApplicationsRepository implements ApplicationsRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx must be read fresh on every call, never cached on `this` -
  // it resolves to the current AsyncLocalStorage-backed transaction (or the
  // base db outside one), and this class is a singleton shared across requests.
  async create(data: NewApplication): Promise<Application> {
    const [row] = await this.txHost.tx
      .insert(applications)
      .values(data)
      .returning();
    return row;
  }

  async findByVacancyAndCandidate(
    vacancyId: string,
    candidateId: string,
  ): Promise<Application | null> {
    const row = await this.txHost.tx.query.applications.findFirst({
      where: { vacancyId, candidateId },
    });
    return row ?? null;
  }

  async findByVacancyIdWithCandidate(
    vacancyId: string,
  ): Promise<ApplicationWithCandidate[]> {
    return this.findManyWithCandidate({ vacancyId });
  }

  async findByIdWithCandidate(
    id: string,
  ): Promise<ApplicationWithCandidate | null> {
    const [row] = await this.findManyWithCandidate({ id });
    return row ?? null;
  }

  async findByCandidateForRecruiter(
    candidateId: string,
    recruiterId: string,
  ): Promise<CandidateApplication[]> {
    // the recruiter filter lives in the query so other recruiters' pipelines
    // can never be returned, whatever the caller does with the rows
    const rows = await this.txHost.tx.query.applications.findMany({
      where: { candidateId, vacancy: { recruiterId } },
      with: {
        candidate: { columns: { parseStatus: true, parsedCvDocumentId: true } },
        vacancy: { columns: { title: true, status: true, criteriaHash: true } },
        score: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      vacancyId: row.vacancyId,
      vacancyTitle: row.vacancy.title,
      vacancyStatus: row.vacancy.status,
      stage: row.stage,
      source: row.source,
      createdAt: row.createdAt,
      score: toApplicationScore(row.score, {
        candidateParseStatus: row.candidate.parseStatus,
        candidateParsedCvDocumentId: row.candidate.parsedCvDocumentId,
        vacancyCriteriaHash: row.vacancy.criteriaHash,
      }),
    }));
  }

  async findByIdWithVacancy(
    id: string,
  ): Promise<ApplicationWithVacancy | null> {
    const row = await this.txHost.tx.query.applications.findFirst({
      where: { id },
      with: { vacancy: { columns: publicVacancyColumnsWith } },
    });
    return row ?? null;
  }

  async updateStage(
    id: string,
    stage: Application['stage'],
  ): Promise<Application> {
    const [row] = await this.txHost.tx
      .update(applications)
      .set({ stage })
      .where(eq(applications.id, id))
      .returning();
    return row;
  }

  private async findManyWithCandidate(
    where: { vacancyId: string } | { id: string },
  ): Promise<ApplicationWithCandidate[]> {
    const rows = await this.txHost.tx.query.applications.findMany({
      where,
      with: {
        // parsedCvDocumentId is read only to derive `score.stale`; it is
        // stripped from the candidate below
        candidate: {
          columns: { parsedAt: false },
          with: latestCvSummaryWith,
        },
        vacancy: { columns: { criteriaHash: true } },
        score: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ candidate, vacancy, score, ...application }) => {
      const { parsedCvDocumentId, ...publicCandidate } = candidate;
      return {
        ...application,
        candidate: withGithub(withCv(publicCandidate)),
        score: toApplicationScore(score, {
          candidateParseStatus: candidate.parseStatus,
          candidateParsedCvDocumentId: parsedCvDocumentId,
          vacancyCriteriaHash: vacancy.criteriaHash,
        }),
      };
    });
  }
}
