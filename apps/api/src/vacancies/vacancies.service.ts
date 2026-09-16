import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { NewVacancy } from '../db/repositories/vacancies.repository.js';
import {
  VACANCIES_REPOSITORY,
  type Vacancy,
  type VacanciesRepository,
} from '../db/repositories/vacancies.repository.js';
import type { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import type { UpdateVacancyDto } from './dto/update-vacancy.dto.js';

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

  async update(
    recruiterId: string,
    vacancyId: string,
    dto: UpdateVacancyDto,
  ): Promise<Vacancy> {
    const vacancy = await this.vacanciesRepository.findById(vacancyId);

    // same 404 for "doesn't exist" and "exists but isn't yours" - don't let
    // a client distinguish which one it is
    if (!vacancy || vacancy.recruiterId !== recruiterId) {
      throw new NotFoundException('Vacancy not found');
    }

    const patch: Partial<NewVacancy> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.requirements !== undefined) patch.requirements = dto.requirements;
    if (dto.status !== undefined) patch.status = dto.status;

    return this.vacanciesRepository.update(vacancyId, patch);
  }
}
