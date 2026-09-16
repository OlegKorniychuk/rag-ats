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

  // Joi's `.port()` (the old schema) allows 0 ("let the OS pick a port"),
  // which the e2e test harness relies on (jest-e2e-setup.ts sets PORT=0) -
  // @Min(0) matches that, not the conventional 1-65535 range.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  public readonly PORT: number = 3000;

  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  public readonly NODE_ENV: string = 'development';
}
