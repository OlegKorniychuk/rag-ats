import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class EnvConfig {
  @IsUrl({ protocols: ['postgres', 'postgresql'], require_tld: false })
  public readonly DATABASE_URL!: string;

  @IsString()
  @MinLength(1)
  public readonly JWT_SECRET!: string;

  @IsOptional()
  @IsString()
  public readonly JWT_EXPIRES_IN: string = '7d';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  public readonly PORT: number = 3000;

  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  public readonly NODE_ENV: string = 'development';
}
