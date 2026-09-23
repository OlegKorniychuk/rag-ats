import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { applications } from '../schema.js';
import type {
  NewApplication,
  Application,
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
}
