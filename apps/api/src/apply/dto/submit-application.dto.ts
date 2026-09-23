import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

export class SubmitApplicationDto {
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

  @ApiProperty({
    type: [String],
    minItems: 1,
    example: ['TypeScript', 'NestJS', 'PostgreSQL'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  skills: string[];

  @ApiProperty({
    minLength: 1,
    example: '3 years building REST APIs with NestJS and Express',
  })
  @IsString()
  @MinLength(1)
  experience: string;

  @ApiProperty({
    type: [String],
    example: ['Built a real-time chat app with WebSockets'],
  })
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  projects: string[];

  @ApiProperty({
    minLength: 1,
    example: 'Backend engineer focused on scalable API design',
  })
  @IsString()
  @MinLength(1)
  summary: string;

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
