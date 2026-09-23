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
  @IsString()
  @MinLength(1)
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  skills: string[];

  @IsString()
  @MinLength(1)
  experience: string;

  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  projects: string[];

  @IsString()
  @MinLength(1)
  summary: string;

  @IsOptional()
  @IsUrl()
  githubUrl?: string;

  @IsOptional()
  @IsUrl()
  portfolioUrl?: string;
}
