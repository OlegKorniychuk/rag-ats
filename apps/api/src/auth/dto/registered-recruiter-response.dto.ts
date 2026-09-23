import { ApiProperty } from '@nestjs/swagger';

export class RegisteredRecruiterResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({ format: 'email', example: 'recruiter@example.com' })
  email: string;
}
