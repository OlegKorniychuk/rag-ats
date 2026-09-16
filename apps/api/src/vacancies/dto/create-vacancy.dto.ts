import { IsString, MinLength } from 'class-validator';

export class CreateVacancyDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  requirements: string;
}
