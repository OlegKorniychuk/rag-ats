import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { applicationStageEnum } from '../../db/schema.js';

export class UpdateApplicationDto {
  @ApiProperty({ enum: applicationStageEnum.enumValues, example: 'screened' })
  @IsIn(applicationStageEnum.enumValues)
  stage: (typeof applicationStageEnum.enumValues)[number];
}
