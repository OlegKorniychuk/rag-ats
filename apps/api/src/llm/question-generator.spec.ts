import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { ScoreResult } from '@rag-ats/shared';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import { cvUnits } from '../scoring/evidence-units.js';
import { questionProblems } from '../scoring/resolve-question-citations.js';
import { capProblems } from './application-scorer.js';
import { normaliseText } from './cv-profile-parser.js';
import type { InterviewQuestionsOutput } from './interview-questions.schema.js';
import type { LlmClient, ParseStructuredResult } from './llm-client.js';
import {
  LlmQuestionError,
  LlmQuestionGroundingError,
  QuestionGenerator,
} from './question-generator.js';

const CV_TEXT =
  'Jane Doe\nBuilt event-driven services with Kafka and Node.js for 5 years.\nUsed Docker Compose for local development only.';
const UNITS = cvUnits(normaliseText(CV_TEXT));
const KAFKA = UNITS.find((u) => u.text.includes('Kafka'))!;
const DOCKER = UNITS.find((u) => u.text.includes('Docker'))!;

const score: ScoreResult = {
  overall: 55,
  rationale: 'Strong backend, no Kubernetes.',
  criteria: [
    {
      criterionId: 'c1',
      criterion: 'Event-driven backend',
      importance: 'must',
      score: 85,
      reasoning: 'Kafka services.',
      quotes: [{ source: 'cv', text: KAFKA.text }],
      retrieved: null,
    },
    {
      criterionId: 'c2',
      criterion: 'Kubernetes in production',
      importance: 'must',
      score: 10,
      reasoning: 'Only Docker Compose.',
      quotes: [{ source: 'cv', text: DOCKER.text }],
      retrieved: null,
    },
  ],
  cvDocumentId: 'cv-1',
  model: 'test-model',
  mode: 'full_text',
  scoredAt: '2026-11-21T10:00:00.000Z',
};

const vacancy = {
  title: 'Backend Engineer',
  requirements: 'Kafka, Kubernetes',
};

const VALID: InterviewQuestionsOutput = {
  questions: [
    {
      text: 'What broke first when you moved services to Kafka?',
      basis: 'fact',
      criterionId: 'c1',
      purpose: 'Checks hands-on Kafka depth.',
      evidence: [KAFKA.id],
    },
    {
      text: 'How would you move a Compose setup to Kubernetes?',
      basis: 'gap',
      criterionId: 'c2',
      purpose: 'Checks orchestration knowledge.',
      evidence: [],
    },
  ],
};
const UNKNOWN: InterviewQuestionsOutput = {
  questions: [{ ...VALID.questions[0], evidence: ['S99'] }],
};

type Call = { system: string; user: string; schemaName: string };

function parsed(
  output: InterviewQuestionsOutput,
): ParseStructuredResult<InterviewQuestionsOutput> {
  return {
    kind: 'parsed',
    parsed: output,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      model: 'test-model',
    },
  };
}

function makeGenerator(
  responses: ParseStructuredResult<InterviewQuestionsOutput>[],
) {
  const calls: Call[] = [];
  let i = 0;
  const llm = {
    model: 'test-model',
    parseStructured: jest.fn(async (params: Call) => {
      calls.push(params);
      return responses[Math.min(i++, responses.length - 1)];
    }),
  } as unknown as LlmClient;
  return { generator: new QuestionGenerator(llm), calls };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('QuestionGenerator', () => {
  it('sends criteria with score and cited ids recovered from the score quotes', async () => {
    const { generator, calls } = makeGenerator([parsed(VALID)]);

    await generator.generate({ vacancy, score, cvText: CV_TEXT });

    expect(calls[0].schemaName).toBe('interview_questions');
    expect(calls[0].user).toContain(
      `c1 [must] score 85 — Event-driven backend — cited: ${KAFKA.id}`,
    );
    expect(calls[0].user).toContain(
      `c2 [must] score 10 — Kubernetes in production — cited: ${DOCKER.id}`,
    );
    expect(calls[0].user).not.toContain('<github>');
  });

  it('returns resolved questions and summed usage on the first attempt', async () => {
    const { generator } = makeGenerator([parsed(VALID)]);

    const result = await generator.generate({
      vacancy,
      score,
      cvText: CV_TEXT,
    });

    expect(result.attempts).toBe(1);
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      model: 'test-model',
    });
    expect(result.questions).toEqual([
      {
        text: 'What broke first when you moved services to Kafka?',
        basis: 'fact',
        criterionId: 'c1',
        criterion: 'Event-driven backend',
        importance: 'must',
        purpose: 'Checks hands-on Kafka depth.',
        quotes: [{ source: 'cv', text: KAFKA.text }],
      },
      {
        text: 'How would you move a Compose setup to Kubernetes?',
        basis: 'gap',
        criterionId: 'c2',
        criterion: 'Kubernetes in production',
        importance: 'must',
        purpose: 'Checks orchestration knowledge.',
        quotes: [],
      },
    ]);
  });

  it('retries once with the problems as feedback, then succeeds', async () => {
    const { generator, calls } = makeGenerator([
      parsed(UNKNOWN),
      parsed(VALID),
    ]);

    const result = await generator.generate({
      vacancy,
      score,
      cvText: CV_TEXT,
    });

    expect(result.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(200);
    expect(calls[1].user).toContain('<feedback>');
    expect(calls[1].user).toContain(questionProblems.unknownEvidence(1, 'S99'));
  });

  it('throws LlmQuestionGroundingError with capped problems after two invalid answers', async () => {
    const many: InterviewQuestionsOutput = {
      questions: Array.from({ length: 10 }, () => ({
        ...VALID.questions[0],
        evidence: ['S90', 'S91', 'S92'],
      })),
    };
    const { generator, calls } = makeGenerator([parsed(many)]);

    const error = await generator
      .generate({ vacancy, score, cvText: CV_TEXT })
      .catch((e: unknown) => e);

    expect(calls).toHaveLength(2);
    expect(error).toBeInstanceOf(LlmQuestionGroundingError);
    expect(error).toBeInstanceOf(LlmQuestionError);
    const grounding = error as LlmQuestionGroundingError;
    expect(grounding.message).toBe(
      'The model cited evidence that could not be resolved',
    );
    expect(grounding.problems).toHaveLength(20);
    expect(grounding.problems).toEqual(
      capProblems(
        Array.from({ length: 10 }, (_, i) =>
          ['S90', 'S91', 'S92'].map((id) =>
            questionProblems.unknownEvidence(i + 1, id),
          ),
        ).flat(),
      ),
    );
  });

  it('throws LlmQuestionError on a refusal', async () => {
    const { generator } = makeGenerator([
      { kind: 'refusal', refusal: 'no', usage: null },
    ]);

    await expect(
      generator.generate({ vacancy, score, cvText: CV_TEXT }),
    ).rejects.toThrow(
      new LlmQuestionError('The model could not generate questions'),
    );
  });

  it('rejects G ids when there is no github block', async () => {
    const citesGithub: InterviewQuestionsOutput = {
      questions: [{ ...VALID.questions[0], evidence: ['G1'] }],
    };
    const { generator, calls } = makeGenerator([parsed(citesGithub)]);

    await expect(
      generator.generate({ vacancy, score, cvText: CV_TEXT, github: null }),
    ).rejects.toBeInstanceOf(LlmQuestionGroundingError);
    expect(calls).toHaveLength(2);
  });

  it('includes github units when the snapshot is ok and resolves G ids', async () => {
    const github: GithubSnapshot = {
      username: 'jane',
      profileUrl: 'https://github.com/jane',
      status: 'ok',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      bio: 'Kafka fan.',
      repos: [],
      languages: [],
    };
    const citesGithub: InterviewQuestionsOutput = {
      questions: [{ ...VALID.questions[0], evidence: ['G1'] }],
    };
    const { generator, calls } = makeGenerator([parsed(citesGithub)]);

    const result = await generator.generate({
      vacancy,
      score,
      cvText: CV_TEXT,
      github,
    });

    expect(calls[0].user).toContain('<github>');
    expect(result.questions[0].quotes[0].source).toBe('github');
  });
});
