import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateVacancyDto {
  @ApiPropertyOptional({ minLength: 1, example: 'Senior Backend Engineer' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({
    minLength: 1,
    example: '5+ years with Node.js and PostgreSQL, strong TypeScript skills',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  requirements?: string;

  @ApiPropertyOptional({ enum: ['open', 'closed'], example: 'closed' })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}
