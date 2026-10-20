import type { VacancyCriterion } from '@rag-ats/shared';
import { getTableColumns } from 'drizzle-orm';
import { vacancies } from '../schema.js';

/**
 * Internal columns, never part of the API shape: the LLM-extracted criteria and
 * the hash of the text they came from. Scoring reads them via `ScoresRepository`.
 */
const { criteria, criteriaHash, ...publicVacancyColumnMap } =
  getTableColumns(vacancies);
void criteria;
void criteriaHash;

/** Column selection for `insert/update ... returning()` in the public shape. */
export const publicVacancyColumns = publicVacancyColumnMap;

/** Relational-query `columns` clause that drops the internal criteria columns. */
export const publicVacancyColumnsWith = {
  criteria: false,
  criteriaHash: false,
} as const;

export type Vacancy = Omit<
  typeof vacancies.$inferSelect,
  'criteria' | 'criteriaHash'
>;
export type NewVacancy = Omit<
  typeof vacancies.$inferInsert,
  'criteria' | 'criteriaHash'
>;

/** What the criteria extraction job needs: the text and the cached hash. */
export interface VacancyCriteriaState {
  title: string;
  requirements: string;
  /** Hash of the title + requirements the stored criteria came from, if any. */
  criteriaHash: string | null;
}

export const VACANCIES_REPOSITORY = Symbol('VACANCIES_REPOSITORY');

export interface VacanciesRepository {
  create(data: NewVacancy): Promise<Vacancy>;
  findById(id: string): Promise<Vacancy | null>;
  findByRecruiterId(recruiterId: string): Promise<Vacancy[]>;
  findByApplyToken(token: string): Promise<Vacancy | null>;
  update(id: string, data: Partial<NewVacancy>): Promise<Vacancy>;
  findCriteriaState(vacancyId: string): Promise<VacancyCriteriaState | null>;
  /**
   * Stores extracted criteria, but only if the vacancy's CURRENT title and
   * requirements still hash to `criteriaHash` (they may have been edited while
   * the LLM was running). Returns false, changing nothing, otherwise.
   */
  saveCriteria(
    vacancyId: string,
    criteria: VacancyCriterion[],
    criteriaHash: string,
  ): Promise<boolean>;
}
