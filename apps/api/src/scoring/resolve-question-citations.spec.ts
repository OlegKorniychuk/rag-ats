import type { EvidenceUnit } from './evidence-units.js';
import type { InterviewQuestionsOutput } from '../llm/interview-questions.schema.js';
import {
  MAX_QUESTIONS,
  questionProblems,
  resolveQuestionCitations,
  type QuestionCriterion,
} from './resolve-question-citations.js';

const unitList: EvidenceUnit[] = [
  { id: 'S1', source: 'cv', text: 'Built Node.js services.' },
  { id: 'S2', source: 'cv', text: 'Led the Kafka migration.' },
  { id: 'S3', source: 'cv', text: 'Docker Compose for local dev.' },
  { id: 'S4', source: 'cv', text: 'Mentored two juniors.' },
  { id: 'G1', source: 'github', text: 'kafka-tools: consumer helpers' },
];
const units = new Map(unitList.map((u) => [u.id, u]));
const noGithub = new Map(
  unitList.filter((u) => u.source === 'cv').map((u) => [u.id, u]),
);

const criteria: QuestionCriterion[] = [
  { id: 'c1', text: 'Event-driven backend', importance: 'must', score: 80 },
  { id: 'c2', text: 'Kubernetes in production', importance: 'must', score: 20 },
  { id: 'c3', text: 'Mentoring', importance: 'nice', score: 60 },
];

type Q = InterviewQuestionsOutput['questions'][number];

function q(overrides: Partial<Q> = {}): Q {
  return {
    text: 'You led the Kafka migration. What broke first?',
    basis: 'fact',
    criterionId: 'c1',
    purpose: 'Checks hands-on Kafka work.',
    evidence: ['S2'],
    ...overrides,
  };
}

function resolve(
  questions: Q[],
  map: ReadonlyMap<string, EvidenceUnit> = units,
) {
  return resolveQuestionCitations({ questions }, map, criteria);
}

describe('resolveQuestionCitations', () => {
  it('resolves fact evidence ids to quotes and copies criterion text and importance', () => {
    const result = resolve([q()]);

    expect(result).toEqual({
      valid: true,
      problems: [],
      questions: [
        {
          text: 'You led the Kafka migration. What broke first?',
          basis: 'fact',
          criterionId: 'c1',
          criterion: 'Event-driven backend',
          importance: 'must',
          purpose: 'Checks hands-on Kafka work.',
          quotes: [{ source: 'cv', text: 'Led the Kafka migration.' }],
        },
      ],
    });
  });

  it('normalises ids like "[s4]." before lookup', () => {
    const result = resolve([q({ criterionId: 'c3', evidence: ['[s4].'] })]);

    expect(result.valid).toBe(true);
    expect(result.questions[0].quotes).toEqual([
      { source: 'cv', text: 'Mentored two juniors.' },
    ]);
  });

  it('reports factWithoutEvidence for a fact with no ids', () => {
    const result = resolve([q({ evidence: [] })]);

    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([questionProblems.factWithoutEvidence(1)]);
  });

  it('reports unknownCriterion and unknownEvidence with the question index', () => {
    const result = resolve([
      q(),
      q({ criterionId: 'c9' }),
      q({ evidence: ['S2', 'S99'] }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      questionProblems.unknownCriterion(2, 'c9'),
      questionProblems.unknownEvidence(3, 'S99'),
    ]);
  });

  it('reports emptyText for a blank question', () => {
    const result = resolve([q({ text: '   ' })]);

    expect(result.problems).toEqual([questionProblems.emptyText(1)]);
  });

  it('accepts a gap with no evidence and a gap with one contrary unit', () => {
    const result = resolve([
      q({ basis: 'gap', criterionId: 'c2', evidence: [] }),
      q({ basis: 'gap', criterionId: 'c2', evidence: ['S3'] }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.questions.map((x) => x.quotes)).toEqual([
      [],
      [{ source: 'cv', text: 'Docker Compose for local dev.' }],
    ]);
  });

  it('keeps at most one contrary quote on a gap question', () => {
    const result = resolve([
      q({ basis: 'gap', criterionId: 'c2', evidence: ['S3', 'S4'] }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.questions[0].quotes).toEqual([
      { source: 'cv', text: 'Docker Compose for local dev.' },
    ]);
  });

  it('does not reject a gap on a criterion scored 50 or more', () => {
    expect(
      resolve([q({ basis: 'gap', criterionId: 'c1', evidence: [] })]).valid,
    ).toBe(true);
  });

  it('accepts a set with only fact questions', () => {
    const result = resolve([q(), q({ criterionId: 'c3', evidence: ['S4'] })]);

    expect(result.valid).toBe(true);
    expect(result.questions.every((x) => x.basis === 'fact')).toBe(true);
  });

  it('reports none() for zero questions and truncates to MAX_QUESTIONS', () => {
    const empty = resolve([]);
    expect(empty.valid).toBe(false);
    expect(empty.problems).toEqual([questionProblems.none()]);

    const many = resolve(Array.from({ length: MAX_QUESTIONS + 3 }, () => q()));
    expect(many.valid).toBe(true);
    expect(many.questions).toHaveLength(MAX_QUESTIONS);
  });

  it('rejects G ids when there is no github block', () => {
    const result = resolve([q({ evidence: ['G1'] })], noGithub);

    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      questionProblems.unknownEvidence(1, 'G1'),
    ]);
  });

  it('caps quotes at 3 and drops duplicate ids', () => {
    const result = resolve([
      q({ evidence: ['S1', 's1', 'S2', 'S3', 'S4', 'G1'] }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.questions[0].quotes.map((x) => x.text)).toEqual([
      'Built Node.js services.',
      'Led the Kafka migration.',
      'Docker Compose for local dev.',
    ]);
  });
});
