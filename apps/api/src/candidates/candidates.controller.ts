import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Candidate } from '../db/repositories/candidates.repository.js';
import { CandidateResponseDto } from './dto/candidate-response.dto.js';
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
}
