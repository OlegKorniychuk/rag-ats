import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { ApplicationWithCandidate } from '../db/repositories/applications.repository.js';
import type { Vacancy } from '../db/repositories/vacancies.repository.js';
import { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import { UpdateVacancyDto } from './dto/update-vacancy.dto.js';
import { VacanciesService } from './vacancies.service.js';

@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateVacancyDto,
  ): Promise<Vacancy> {
    return this.vacanciesService.create(user.id, dto);
  }

  @Get()
  async findAllMine(@CurrentUser() user: AuthUser): Promise<Vacancy[]> {
    return this.vacanciesService.findAllMine(user.id);
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Vacancy> {
    return this.vacanciesService.findOne(user.id, id);
  }

  @Get(':id/applications')
  async findApplications(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationWithCandidate[]> {
    return this.vacanciesService.findApplications(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVacancyDto,
  ): Promise<Vacancy> {
    return this.vacanciesService.update(user.id, id, dto);
  }
}
