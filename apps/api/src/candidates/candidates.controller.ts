import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Candidate } from '../db/repositories/candidates.repository.js';
import { CandidateResponseDto } from './dto/candidate-response.dto.js';
import { buildContentDisposition } from './cv-response-headers.js';
import { CandidatesService } from './candidates.service.js';

@ApiTags('candidates')
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

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
}
