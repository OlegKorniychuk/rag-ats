import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { Vacancy } from '../db/repositories/vacancies.repository.js';
import { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import { UpdateVacancyDto } from './dto/update-vacancy.dto.js';
import { VacanciesService } from './vacancies.service.js';

@Controller('vacancies')
@UseGuards(JwtAuthGuard)
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateVacancyDto,
  ): Promise<Vacancy> {
    return this.vacanciesService.create(user.id, dto);
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
