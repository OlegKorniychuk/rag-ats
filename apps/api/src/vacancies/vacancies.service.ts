import { Inject, Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  VACANCIES_REPOSITORY,
  type Vacancy,
  type VacanciesRepository,
} from '../db/repositories/vacancies.repository.js';
import type { CreateVacancyDto } from './dto/create-vacancy.dto.js';

@Injectable()
export class VacanciesService {
  constructor(
    @Inject(VACANCIES_REPOSITORY)
    private readonly vacanciesRepository: VacanciesRepository,
  ) {}

  async create(recruiterId: string, dto: CreateVacancyDto): Promise<Vacancy> {
    return this.vacanciesRepository.create({
      recruiterId,
      title: dto.title,
      requirements: dto.requirements,
      applyToken: nanoid(),
    });
  }
}
