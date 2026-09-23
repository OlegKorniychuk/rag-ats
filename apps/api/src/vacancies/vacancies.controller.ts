import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { ApplicationWithCandidate } from '../db/repositories/applications.repository.js';
import type { Vacancy } from '../db/repositories/vacancies.repository.js';
import { ApplicationWithCandidateResponseDto } from '../applications/dto/application-with-candidate-response.dto.js';
import { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import { UpdateVacancyDto } from './dto/update-vacancy.dto.js';
import { VacancyResponseDto } from './dto/vacancy-response.dto.js';
import { VacanciesService } from './vacancies.service.js';

@ApiTags('vacancies')
@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a vacancy owned by the current recruiter' })
  @ApiCreatedResponse({
    description: 'Vacancy created',
    type: VacancyResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateVacancyDto,
  ): Promise<Vacancy> {
    return this.vacanciesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the current recruiter's vacancies" })
  @ApiOkResponse({
    description: "The recruiter's vacancies",
    type: [VacancyResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  async findAllMine(@CurrentUser() user: AuthUser): Promise<Vacancy[]> {
    return this.vacanciesService.findAllMine(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a vacancy owned by the current recruiter' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'The vacancy', type: VacancyResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({
    description: "Vacancy doesn't exist or belongs to another recruiter",
  })
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Vacancy> {
    return this.vacanciesService.findOne(user.id, id);
  }

  @Get(':id/applications')
  @ApiOperation({
    summary:
      'List applications submitted for a vacancy, with candidate details',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Applications for the vacancy',
    type: [ApplicationWithCandidateResponseDto],
  })
  @ApiBadRequestResponse({ description: 'Malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({
    description: "Vacancy doesn't exist or belongs to another recruiter",
  })
  async findApplications(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationWithCandidate[]> {
    return this.vacanciesService.findApplications(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a vacancy owned by the current recruiter' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'The updated vacancy',
    type: VacancyResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed or malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({
    description: "Vacancy doesn't exist or belongs to another recruiter",
  })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVacancyDto,
  ): Promise<Vacancy> {
    return this.vacanciesService.update(user.id, id, dto);
  }
}
