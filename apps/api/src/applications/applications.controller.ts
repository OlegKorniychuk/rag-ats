import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { ApplicationScore } from '@rag-ats/shared';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Application } from '../db/repositories/applications.repository.js';
import { ApplicationScoreResponseDto } from './dto/application-score-response.dto.js';
import { ApplicationResponseDto } from './dto/application-response.dto.js';
import { UpdateApplicationDto } from './dto/update-application.dto.js';
import { ApplicationsService } from './applications.service.js';

@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Move an application to a different pipeline stage',
    description:
      'The application must belong to a vacancy owned by the current recruiter.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'The updated application',
    type: ApplicationResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed or malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({
    description: "Application doesn't exist or belongs to another recruiter",
  })
  async updateStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ): Promise<Application> {
    return this.applicationsService.updateStage(user.id, id, dto);
  }

  @Post(':id/rescore')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Re-run scoring of an application',
    description:
      'The application must belong to a vacancy owned by the current recruiter. Sets the score to `pending` (the last result is kept, marked stale) and returns immediately; scoring runs asynchronously.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiAcceptedResponse({
    description: 'Scoring queued; the score is now pending',
    type: ApplicationScoreResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Malformed uuid' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiNotFoundResponse({
    description: "Application doesn't exist or belongs to another recruiter",
  })
  @ApiConflictResponse({ description: 'Scoring already in progress' })
  async rescore(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationScore> {
    return this.applicationsService.rescore(user.id, id);
  }
}
