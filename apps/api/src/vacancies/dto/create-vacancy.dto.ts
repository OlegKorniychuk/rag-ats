import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import type { CreateVacancyRequest } from '@rag-ats/shared';

export class CreateVacancyDto implements CreateVacancyRequest {
  @ApiProperty({ minLength: 1, example: 'Senior Backend Engineer' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty({
    minLength: 1,
    example: '5+ years with Node.js and PostgreSQL, strong TypeScript skills',
  })
  @IsString()
  @MinLength(1)
  requirements: string;
}
