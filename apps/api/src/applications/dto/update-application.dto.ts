import { IsIn } from 'class-validator';
import { applicationStageEnum } from '../../db/schema.js';

export class UpdateApplicationDto {
  @IsIn(applicationStageEnum.enumValues)
  stage: (typeof applicationStageEnum.enumValues)[number];
}
