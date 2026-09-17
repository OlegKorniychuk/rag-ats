import { vacancies } from '../schema.js';

export type Vacancy = typeof vacancies.$inferSelect;
export type NewVacancy = typeof vacancies.$inferInsert;

export const VACANCIES_REPOSITORY = Symbol('VACANCIES_REPOSITORY');

export interface VacanciesRepository {
  create(data: NewVacancy): Promise<Vacancy>;
  findById(id: string): Promise<Vacancy | null>;
  findByRecruiterId(recruiterId: string): Promise<Vacancy[]>;
  findByApplyToken(token: string): Promise<Vacancy | null>;
  update(id: string, data: Partial<NewVacancy>): Promise<Vacancy>;
}
