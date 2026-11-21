import { ApiProperty } from '@nestjs/swagger';
import type {
  ApplicationQuestions,
  CriterionImportance,
  InterviewQuestion,
  QuestionBasis,
  QuestionSet,
  QuestionStatus,
} from '@rag-ats/shared';
import { questionStatusEnum } from '../../db/schema.js';
import { ScoreQuoteResponseDto } from './score-quote-response.dto.js';

export class InterviewQuestionDto implements InterviewQuestion {
  @ApiProperty({
    example:
      'You led the Kafka migration at Acme. What broke first, and how did you find it?',
  })
  text: string;

  @ApiProperty({
    enum: ['fact', 'gap'],
    example: 'fact',
    description:
      '`fact`: probes something the cited evidence states; `gap`: probes a criterion the candidate scored low on',
  })
  basis: QuestionBasis;

  @ApiProperty({ example: 'c1' })
  criterionId: string;

  @ApiProperty({
    example: 'Event-driven backend',
    description: 'Criterion text',
  })
  criterion: string;

  @ApiProperty({ enum: ['must', 'nice'], example: 'must' })
  importance: CriterionImportance;

  @ApiProperty({
    example: 'Checks hands-on experience with Kafka in production.',
    description: 'What the answer will tell the recruiter',
  })
  purpose: string;

  @ApiProperty({
    type: () => [ScoreQuoteResponseDto],
    description:
      'Verbatim evidence resolved server-side: 1-3 for a fact, 0-1 (a contrary fact) for a gap',
  })
  quotes: ScoreQuoteResponseDto[];
}

export class QuestionSetDto implements QuestionSet {
  @ApiProperty({ type: () => [InterviewQuestionDto] })
  questions: InterviewQuestionDto[];

  @ApiProperty({
    format: 'uuid',
    description: 'The CV the questions were generated from',
  })
  cvDocumentId: string;

  @ApiProperty({ example: 'gpt-5.4-mini' })
  model: string;

  @ApiProperty({ format: 'date-time' })
  generatedAt: string;
}

export class ApplicationQuestionsResponseDto implements ApplicationQuestions {
  @ApiProperty({
    enum: questionStatusEnum.enumValues,
    nullable: true,
    example: 'ready',
    description:
      'Progress of the background generation; null when questions were never requested',
  })
  status: QuestionStatus | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Short, safe reason when status is failed; otherwise null',
  })
  error: string | null;

  @ApiProperty({
    example: false,
    description:
      'True when result was not generated from the current CV, criteria and score (or a regeneration is pending)',
  })
  stale: boolean;

  @ApiProperty({
    type: () => QuestionSetDto,
    nullable: true,
    description: 'The last good set; kept while a regeneration is pending',
  })
  result: QuestionSetDto | null;
}
