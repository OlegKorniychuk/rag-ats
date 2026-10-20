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
    const rows = await this.txHost.tx.query.applications.findMany({
      where: { vacancyId },
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
}
