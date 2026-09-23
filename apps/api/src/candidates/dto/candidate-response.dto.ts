import { ApiProperty } from '@nestjs/swagger';
import type { Candidate } from '../../db/repositories/candidates.repository.js';

export class CandidateResponseDto implements Candidate {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiProperty({ format: 'email', example: 'jane.doe@example.com' })
  email: string;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uri',
    example: 'https://github.com/janedoe',
  })
  githubUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uri',
    example: 'https://janedoe.dev',
  })
  portfolioUrl: string | null;

  @ApiProperty({
    type: [String],
    example: ['TypeScript', 'NestJS', 'PostgreSQL'],
  })
  skills: string[];

  @ApiProperty({
    example: '3 years building REST APIs with NestJS and Express',
  })
  experience: string;

  @ApiProperty({
    type: [String],
    example: ['Built a real-time chat app with WebSockets'],
  })
  projects: string[];

  @ApiProperty({
    example: 'Backend engineer focused on scalable API design',
  })
  summary: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  createdAt: Date;
}
