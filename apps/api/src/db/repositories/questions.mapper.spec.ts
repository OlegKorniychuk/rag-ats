import type { QuestionSet } from '@rag-ats/shared';
import {
  toApplicationQuestions,
  type QuestionContext,
  type QuestionRow,
} from './questions.mapper.js';

const scoredAt = new Date('2026-11-21T10:00:00.000Z');

const context: QuestionContext = {
  scoreScoredAt: scoredAt,
  candidateParsedCvDocumentId: 'cv-1',
  vacancyCriteriaHash: 'hash-1',
};

const result: QuestionSet = {
  questions: [
    {
      text: 'You led the Kafka migration. What broke first?',
      basis: 'fact',
      criterionId: 'c1',
      criterion: 'Event-driven backend',
      importance: 'must',
      purpose: 'Checks hands-on Kafka work.',
      quotes: [{ source: 'cv', text: 'Led the Kafka migration' }],
    },
  ],
  cvDocumentId: 'cv-1',
  model: 'm',
  generatedAt: '2026-11-21T10:05:00.000Z',
};

function row(overrides: Partial<QuestionRow> = {}): QuestionRow {
  return {
    status: 'ready',
    error: null,
    result,
    cvDocumentId: 'cv-1',
    criteriaHash: 'hash-1',
    scoreScoredAt: scoredAt,
    ...overrides,
  };
}

describe('toApplicationQuestions', () => {
  it('returns status null and no result without a row', () => {
    expect(toApplicationQuestions(null, context)).toEqual({
      status: null,
      error: null,
      stale: false,
      result: null,
    });
  });

  it('is not stale when cv, criteria hash and score time match', () => {
    expect(toApplicationQuestions(row(), context)).toEqual({
      status: 'ready',
      error: null,
      stale: false,
      result,
    });
  });

  it('is stale when the score was re-scored after generation', () => {
    const questions = toApplicationQuestions(row(), {
      ...context,
      scoreScoredAt: new Date('2026-11-21T11:00:00.000Z'),
    });

    expect(questions.stale).toBe(true);
  });

  it('is stale when the cv or criteria hash changed', () => {
    expect(
      toApplicationQuestions(row(), {
        ...context,
        candidateParsedCvDocumentId: 'cv-2',
      }).stale,
    ).toBe(true);
    expect(
      toApplicationQuestions(row(), { ...context, vacancyCriteriaHash: 'h2' })
        .stale,
    ).toBe(true);
  });

  it('is stale while regenerating with a previous result', () => {
    const questions = toApplicationQuestions(
      row({ status: 'pending' }),
      context,
    );

    expect(questions).toMatchObject({ status: 'pending', stale: true, result });
  });

  it('is not stale without a result, and never maps internal columns', () => {
    const questions = toApplicationQuestions(
      row({
        status: 'failed',
        error: 'Could not generate questions',
        result: null,
      }),
      context,
    );

    expect(questions).toEqual({
      status: 'failed',
      error: 'Could not generate questions',
      stale: false,
      result: null,
    });
  });
});
