import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import type { SubmitApplicationRequest } from '@rag-ats/shared';

export class SubmitApplicationDto implements SubmitApplicationRequest {
  @ApiProperty({ minLength: 1, example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ format: 'email', example: 'jane.doe@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    format: 'uri',
    example: 'https://github.com/janedoe',
  })
  @IsOptional()
  @IsUrl()
  githubUrl?: string;

  @ApiPropertyOptional({
    format: 'uri',
    example: 'https://janedoe.dev',
  })
  @IsOptional()
  @IsUrl()
  portfolioUrl?: string;
}
