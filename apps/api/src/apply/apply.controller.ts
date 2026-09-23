import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import {
  ApplyService,
  type PublicVacancy,
  type SubmitApplicationResult,
} from './apply.service.js';
import { PublicVacancyResponseDto } from './dto/public-vacancy-response.dto.js';
import { SubmitApplicationDto } from './dto/submit-application.dto.js';
import { SuccessResponseDto } from '../common/dto/success-response.dto.js';

@ApiTags('apply')
@Controller('apply')
@Public()
export class ApplyController {
  constructor(private readonly applyService: ApplyService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Get the public vacancy details for an apply link' })
  @ApiParam({ name: 'token', description: 'The vacancy apply token' })
  @ApiOkResponse({
    description: 'The public vacancy details',
    type: PublicVacancyResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Unknown apply token' })
  async getByToken(@Param('token') token: string): Promise<PublicVacancy> {
    return this.applyService.getByToken(token);
  }

  @Post(':token')
  @ApiOperation({ summary: 'Submit an application for a vacancy' })
  @ApiParam({ name: 'token', description: 'The vacancy apply token' })
  @ApiCreatedResponse({
    description: 'Application submitted',
    type: SuccessResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Unknown apply token' })
  @ApiConflictResponse({
    description: 'Vacancy is closed, or candidate already applied',
  })
  async submit(
    @Param('token') token: string,
    @Body() dto: SubmitApplicationDto,
  ): Promise<SubmitApplicationResult> {
    return this.applyService.submit(token, dto);
  }
}
