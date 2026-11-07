import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { ApplicationWithCandidate } from '../db/repositories/applications.repository.js';
import type { Vacancy } from '../db/repositories/vacancies.repository.js';
import { ApplicationWithCandidateResponseDto } from '../applications/dto/application-with-candidate-response.dto.js';
import { AddApplicationDto } from './dto/add-application.dto.js';
import { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import { VacancyMatchesQueryDto } from './dto/vacancy-matches-query.dto.js';
import { VacancyMatchesResponseDto } from './dto/vacancy-matches-response.dto.js';
import { UpdateVacancyDto } from './dto/update-vacancy.dto.js';
import { VacancyResponseDto } from './dto/vacancy-response.dto.js';
import {
  VacancyMatchService,
  type VacancyMatchesHits,
} from './matches/vacancy-match.service.js';
import { VacanciesService } from './vacancies.service.js';

@ApiTags('vacancies')
@Controller('vacancies')
export class VacanciesController {
  constructor(
    private readonly vacanciesService: VacanciesService,
    private readonly matchService: VacancyMatchService,
  ) {}

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

  @Get(':id/matches')
  @ApiOperation({
    summary: 'Find pool candidates that fit a vacancy',
    description:
      "Ranks the shared candidate pool for an open vacancy of the current recruiter and returns up to 10 candidates, best first, each with the criteria they match and their best-matching snippets. Candidates already on the vacancy (any stage) are excluded. In `criteria` mode (default) the vacancy's criteria are extracted first if they are not current. Candidates whose CV has not been processed yet do not appear.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: ['criteria', 'whole_text'],
    description: 'Retrieval mode (default `criteria`)',
  })
  @ApiOkResponse({
    description: 'Matching candidates, best first (empty when nothing matches)',
    type: VacancyMatchesResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Malformed uuid or unknown mode' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({
    description: "Vacancy doesn't exist or belongs to another recruiter",
  })
  @ApiConflictResponse({ description: 'Vacancy is closed' })
  @ApiServiceUnavailableResponse({
    description:
      'The embedding service or the criteria extraction is unavailable',
  })
  async findMatches(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VacancyMatchesQueryDto,
  ): Promise<VacancyMatchesHits> {
    return this.matchService.findMatches(user.id, id, query.mode);
  }

  @Post(':id/applications')
  @ApiOperation({
    summary: 'Add an existing pool candidate to a vacancy',
    description:
      'Creates an application with source `added` and queues its scoring. If the candidate is still being parsed, the score waits for the parse.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({
    description: 'The new application, with candidate details',
    type: ApplicationWithCandidateResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed uuid',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({
    description:
      "Vacancy doesn't exist or belongs to another recruiter, or unknown candidate id",
  })
  @ApiConflictResponse({
    description: 'Vacancy is closed, or the candidate is already on it',
  })
  async addCandidate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddApplicationDto,
  ): Promise<ApplicationWithCandidate> {
    return this.vacanciesService.addCandidate(user.id, id, dto.candidateId);
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
