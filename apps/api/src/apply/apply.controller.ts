import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
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
import { CV_FIELD_NAME, CV_MAX_SIZE_BYTES } from '../cv/cv.constants.js';
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
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'email', CV_FIELD_NAME],
      properties: {
        name: { type: 'string', minLength: 1, example: 'Jane Doe' },
        email: {
          type: 'string',
          format: 'email',
          example: 'jane.doe@example.com',
        },
        githubUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://github.com/janedoe',
        },
        portfolioUrl: {
          type: 'string',
          format: 'uri',
          example: 'https://janedoe.dev',
        },
        [CV_FIELD_NAME]: {
          type: 'string',
          format: 'binary',
          description: 'CV as a PDF file, up to 5 MB',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed, or the CV is missing, not a PDF, or has no readable text',
  })
  @ApiPayloadTooLargeResponse({ description: 'CV is larger than 5 MB' })
  @ApiNotFoundResponse({ description: 'Unknown apply token' })
  @ApiConflictResponse({
    description: 'Vacancy is closed, or candidate already applied',
  })
  @UseInterceptors(
    FileInterceptor(CV_FIELD_NAME, {
      limits: { fileSize: CV_MAX_SIZE_BYTES, files: 1 },
    }),
  )
  async submit(
    @Param('token') token: string,
    @Body() dto: SubmitApplicationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SubmitApplicationResult> {
    return this.applyService.submit(token, dto, file);
  }
}
