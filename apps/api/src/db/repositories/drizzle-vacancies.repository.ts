import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { VacancyCriterion } from '@rag-ats/shared';
import { eq } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { vacancies } from '../schema.js';
import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';
import {
  publicVacancyColumns,
  publicVacancyColumnsWith,
} from './vacancies.repository.js';
import type {
  NewVacancy,
  Vacancy,
  VacancyCriteriaState,
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
      .returning(publicVacancyColumns);
    return row;
  }

  async findById(id: string): Promise<Vacancy | null> {
    const row = await this.txHost.tx.query.vacancies.findFirst({
      where: { id },
      columns: publicVacancyColumnsWith,
    });
    return row ?? null;
  }

  async findByRecruiterId(recruiterId: string): Promise<Vacancy[]> {
    return this.txHost.tx.query.vacancies.findMany({
      where: { recruiterId },
      columns: publicVacancyColumnsWith,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByApplyToken(token: string): Promise<Vacancy | null> {
    const row = await this.txHost.tx.query.vacancies.findFirst({
      where: { applyToken: token },
      columns: publicVacancyColumnsWith,
    });
    return row ?? null;
  }

  async update(id: string, data: Partial<NewVacancy>): Promise<Vacancy> {
    const [row] = await this.txHost.tx
      .update(vacancies)
      .set(data)
      .where(eq(vacancies.id, id))
      .returning(publicVacancyColumns);
    return row;
  }

  async findCriteriaState(
    vacancyId: string,
  ): Promise<VacancyCriteriaState | null> {
    const row = await this.txHost.tx.query.vacancies.findFirst({
      where: { id: vacancyId },
      columns: { title: true, requirements: true, criteriaHash: true },
    });
    return row ?? null;
  }

  async saveCriteria(
    vacancyId: string,
    criteria: VacancyCriterion[],
    criteriaHash: string,
  ): Promise<boolean> {
    // lock the row so a concurrent edit cannot slip between the check and the
    // write; joins the surrounding transaction as a savepoint when there is one
    return this.txHost.tx.transaction(async (tx) => {
      const [current] = await tx
        .select({
          title: vacancies.title,
          requirements: vacancies.requirements,
        })
        .from(vacancies)
        .where(eq(vacancies.id, vacancyId))
        .for('update');
      if (
        !current ||
        vacancyCriteriaHash(current.title, current.requirements) !==
          criteriaHash
      ) {
        return false;
      }
      await tx
        .update(vacancies)
        .set({ criteria, criteriaHash })
        .where(eq(vacancies.id, vacancyId));
      return true;
    });
  }
}
