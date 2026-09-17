import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  VACANCIES_REPOSITORY,
  type Vacancy,
  type VacanciesRepository,
} from '../db/repositories/vacancies.repository.js';

export type PublicVacancy = Pick<Vacancy, 'title' | 'requirements' | 'status'>;

@Injectable()
export class ApplyService {
  constructor(
    @Inject(VACANCIES_REPOSITORY)
    private readonly vacanciesRepository: VacanciesRepository,
  ) {}

  async getByToken(token: string): Promise<PublicVacancy> {
    const vacancy = await this.vacanciesRepository.findByApplyToken(token);

    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }

    return {
      title: vacancy.title,
      requirements: vacancy.requirements,
      status: vacancy.status,
    };
  }
}
