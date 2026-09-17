import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { vacancies } from '../schema.js';
import type {
  NewVacancy,
  Vacancy,
  VacanciesRepository,
} from './vacancies.repository.js';

@Injectable()
export class DrizzleVacanciesRepository implements VacanciesRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx must be read fresh on every call, never cached on `this` -
  // it resolves to the current AsyncLocalStorage-backed transaction (or the
  // base db outside one), and this class is a singleton shared across requests.
  async create(data: NewVacancy): Promise<Vacancy> {
    const [row] = await this.txHost.tx
      .insert(vacancies)
      .values(data)
      .returning();
    return row;
  }

  async findById(id: string): Promise<Vacancy | null> {
    const row = await this.txHost.tx.query.vacancies.findFirst({
      where: { id },
    });
    return row ?? null;
  }

  async update(id: string, data: Partial<NewVacancy>): Promise<Vacancy> {
    const [row] = await this.txHost.tx
      .update(vacancies)
      .set(data)
      .where(eq(vacancies.id, id))
      .returning();
    return row;
  }
}
