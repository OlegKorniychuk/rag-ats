import type { InterviewQuestion } from '@rag-ats/shared';
import type { QuestionsRecord } from './metrics.js';

export function question(
  overrides: Partial<InterviewQuestion> = {},
): InterviewQuestion {
  return {
    text: 'What broke first?',
    basis: 'fact',
    criterionId: 'c1',
    criterion: 'Kafka',
    importance: 'must',
    purpose: 'Checks Kafka depth.',
    quotes: [{ source: 'cv', text: 'Led the Kafka migration.' }],
    ...overrides,
  };
}

/**
 * Three records: strong (ok, 1 attempt, 2 facts + 1 gap), weak (ok, retried,
 * 1 fact + 2 gaps), partial (failed).
 */
export function threeRecords(): QuestionsRecord[] {
  return [
    {
      item: {
        applicationId: 'a1',
        vacancySpecId: 'v1',
        personaId: 'p1',
        band: 'strong',
      },
      status: 'ok',
      attempts: 1,
      error: null,
      questions: [
        question(),
        question({
          criterionId: 'c2',
          criterion: 'Postgres',
          quotes: [{ source: 'cv', text: 'Not cited by the score.' }],
        }),
        question({
          basis: 'gap',
          criterionId: 'c3',
          criterion: 'Kubernetes',
          quotes: [],
        }),
      ],
      criterionScores: { c1: 90, c2: 80, c3: 20 },
      scoreCitedTexts: {
        c1: ['Led the Kafka migration.'],
        c2: ['Designed Postgres schemas.'],
        c3: [],
      },
      inputTokens: 1_000_000,
      outputTokens: 0,
    },
    {
      item: {
        applicationId: 'a2',
        vacancySpecId: 'v1',
        personaId: 'p2',
        band: 'weak',
      },
      status: 'ok',
      attempts: 2,
      error: null,
      questions: [
        question(),
        question({ basis: 'gap', criterionId: 'c2', quotes: [] }),
        question({ basis: 'gap', criterionId: 'c3', quotes: [] }),
      ],
      criterionScores: { c1: 30, c2: 60, c3: 0 },
      scoreCitedTexts: { c1: ['Led the Kafka migration.'], c2: [], c3: [] },
      inputTokens: 0,
      outputTokens: 1_000_000,
    },
    {
      item: {
        applicationId: 'a3',
        vacancySpecId: 'v2',
        personaId: 'p3',
        band: 'partial',
      },
      status: 'failed',
      attempts: null,
      error: 'The model cited evidence that could not be resolved',
      questions: [],
      criterionScores: { c1: 50 },
      scoreCitedTexts: { c1: [] },
      inputTokens: 0,
      outputTokens: 0,
    },
  ];
}
