import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type {
  ApplicationStage,
  UpdateApplicationRequest,
} from '@rag-ats/shared';
import { applicationStageEnum } from '../../db/schema.js';

export class UpdateApplicationDto implements UpdateApplicationRequest {
  @ApiProperty({ enum: applicationStageEnum.enumValues, example: 'screened' })
  @IsIn(applicationStageEnum.enumValues)
  stage: ApplicationStage;
}
