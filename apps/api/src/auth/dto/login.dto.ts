import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'recruiter@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, example: 'hunter22' })
  @IsString()
  @MinLength(8)
  password: string;
}
