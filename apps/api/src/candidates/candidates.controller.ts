import {
  Controller,
  Get,
  Header,
  Body,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { CandidateApplication } from '../db/repositories/applications.repository.js';
import type { Candidate } from '../db/repositories/candidates.repository.js';
import { CandidateApplicationResponseDto } from './dto/candidate-application-response.dto.js';
import { CandidateResponseDto } from './dto/candidate-response.dto.js';
import { CandidateSearchResultResponseDto } from './dto/candidate-search-result-response.dto.js';
import { SearchCandidatesRequestDto } from './dto/search-candidates-request.dto.js';
import { buildContentDisposition } from './cv-response-headers.js';
import { CandidatesService } from './candidates.service.js';
import {
  CandidateSearchService,
  type CandidateSearchHit,
} from './search/candidate-search.service.js';

@ApiTags('candidates')
@Controller('candidates')
export class CandidatesController {
  constructor(
    private readonly candidatesService: CandidatesService,
    private readonly searchService: CandidateSearchService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the shared candidate pool',
    description:
      'Visible to any recruiter. Profile data only - does not include applications.',
  })
  @ApiOkResponse({
    description: 'All candidates',
    type: [CandidateResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  async findAll(): Promise<Candidate[]> {
    return this.candidatesService.findAll();
  }

  @Post('search')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Semantic search over the shared candidate pool',
    description:
      "Visible to any recruiter. Matches the query against chunks of candidates' CVs and GitHub profiles and returns up to 20 candidates, best first, each with its best-matching snippets. Candidates whose CV has not been processed yet do not appear.",
  })
  @ApiOkResponse({
    description: 'Matching candidates, best first (empty when nothing matches)',
    type: [CandidateSearchResultResponseDto],
  })
  @ApiBadRequestResponse({
    description: 'Missing, non-string, blank or over-500-character query',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiServiceUnavailableResponse({
    description: 'The embedding service is unavailable',
  })
  async search(
    @Body() body: SearchCandidatesRequestDto,
  ): Promise<CandidateSearchHit[]> {
    return this.searchService.search(body.query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a candidate from the shared pool',
    description:
      'Visible to any recruiter. Profile data only - does not include applications.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'The candidate', type: CandidateResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({ description: 'Unknown candidate id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Candidate> {
    return this.candidatesService.findOne(id);
  }

  @Get(':id/applications')
  @ApiOperation({
    summary:
      "List a candidate's applications on the current recruiter's vacancies",
    description:
      "Only the current recruiter's own vacancies are included, newest first: the pool is shared, pipelines are not.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: "The candidate's applications on the recruiter's vacancies",
    type: [CandidateApplicationResponseDto],
  })
  @ApiBadRequestResponse({ description: 'Malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({ description: 'Unknown candidate id' })
  async findApplications(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CandidateApplication[]> {
    return this.candidatesService.findApplications(user.id, id);
  }

  @Get(':id/cv')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: "Download a candidate's latest CV",
    description:
      'Visible to any recruiter. Returns the most recently uploaded CV as an inline PDF.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The latest CV as a PDF',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({ description: 'Malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({ description: 'Unknown candidate id' })
  async downloadCv(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const cv = await this.candidatesService.findLatestCv(id);

    return new StreamableFile(cv.content, {
      type: 'application/pdf',
      disposition: buildContentDisposition(cv.filename),
      length: cv.content.length,
    });
  }

  @Post(':id/reparse')
  @HttpCode(202)
  @ApiOperation({
    summary: "Re-run LLM parsing of a candidate's latest CV",
    description:
      'Allowed when the parse status is `parsed` or `failed`. Sets the status to `pending` and returns immediately; the profile is refreshed asynchronously.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiAcceptedResponse({
    description: 'Parsing queued; the candidate is now pending',
    type: CandidateResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({ description: 'Unknown candidate id' })
  @ApiConflictResponse({ description: 'CV parsing is already in progress' })
  async reparse(@Param('id', ParseUUIDPipe) id: string): Promise<Candidate> {
    return this.candidatesService.reparse(id);
  }
}
