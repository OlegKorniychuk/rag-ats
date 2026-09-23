import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { applications } from '../schema.js';
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
    return this.txHost.tx.query.applications.findMany({
      where: { vacancyId },
      with: { candidate: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdWithVacancy(
    id: string,
  ): Promise<ApplicationWithVacancy | null> {
    const row = await this.txHost.tx.query.applications.findFirst({
      where: { id },
      with: { vacancy: true },
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
