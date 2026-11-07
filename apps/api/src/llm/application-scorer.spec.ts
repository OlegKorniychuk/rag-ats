import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { setupServer } from 'msw/node';
import type { EnvConfig } from '../config/env.config.js';
import {
  captureOpenaiRequests,
  fabricatedScoreResponse,
  messageContent,
  openaiMalformedJsonHandler,
  openaiRefusalHandler,
  openaiScoreHandler,
  scoreFromRequest,
  validScoreResponse,
  type MockScoreResponse,
  type OpenaiRequestBody,
} from '../../test/msw/openai.handlers.js';
import {
  ApplicationScorer,
  LlmGroundingError,
  LlmScoreError,
  type ScoringCriterion,
} from './application-scorer.js';
import { LlmClient } from './llm-client.js';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import { buildGithubBlock } from './prompts/cv-profile.prompt.js';

const MODEL = 'test-model';
const server = setupServer();
const capture = captureOpenaiRequests();

function makeScorer() {
  const config = {
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: MODEL,
  } as EnvConfig;
  return new ApplicationScorer(new LlmClient(config));
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', capture.listener);
});
let logSpy: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  logSpy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  server.resetHandlers();
  capture.bodies.length = 0;
  jest.restoreAllMocks();
});
afterAll(() => server.close());

const CRITERIA: ScoringCriterion[] = [
  { id: 'c1', text: 'TypeScript experience', importance: 'must' },
  { id: 'c2', text: 'REST API design', importance: 'must' },
  { id: 'c3', text: 'Docker knowledge', importance: 'nice' },
];
const IDS = CRITERIA.map((c) => c.id);

const CV_TEXT =
  'Jane Doe\nSenior Backend Engineer\nBuilt REST APIs with NestJS and TypeScript for 5 years.\nUsed Docker in CI.';
const CV_QUOTE = {
  source: 'cv' as const,
  text: 'Built REST APIs with NestJS and TypeScript',
};

function snapshot(overrides: Partial<GithubSnapshot> = {}): GithubSnapshot {
  return {
    username: 'janedoe',
    profileUrl: 'https://github.com/janedoe',
    status: 'ok',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    bio: 'Backend engineer.',
    repos: [
      {
        name: 'alpha',
        url: 'https://github.com/janedoe/alpha',
        description: 'A NestJS API',
        language: 'TypeScript',
        stars: 50,
        topics: ['nestjs'],
        pushedAt: '2026-03-01T00:00:00Z',
        readmeExcerpt: 'Alpha is a REST service built with NestJS.',
      },
    ],
    languages: [{ name: 'TypeScript', repoCount: 1 }],
    ...overrides,
  };
}

/** Answers with the given responses in order (the last one repeats). */
function sequence(responses: Array<MockScoreResponse>, usage = true) {
  let i = 0;
  return openaiScoreHandler(
    () => responses[Math.min(i++, responses.length - 1)],
    {
      usage: usage
        ? { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }
        : undefined,
    },
  );
}

const userOf = (body: OpenaiRequestBody) => messageContent(body, 'user');

describe('ApplicationScorer', () => {
  it('scores on the first valid answer with one request', async () => {
    server.use(
      openaiScoreHandler(
        validScoreResponse(IDS, CV_QUOTE, {
          rationale: ' Strong backend fit. ',
        }),
      ),
    );

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.rationale).toBe('Strong backend fit.');
    expect(result.criteria).toEqual([
      {
        criterionId: 'c1',
        criterion: 'TypeScript experience',
        importance: 'must',
        score: 80,
        reasoning: 'Evidence found for c1.',
        quotes: [CV_QUOTE],
        retrieved: null,
      },
      expect.objectContaining({ criterionId: 'c2', importance: 'must' }),
      expect.objectContaining({
        criterionId: 'c3',
        criterion: 'Docker knowledge',
        importance: 'nice',
      }),
    ]);
    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      model: 'gpt-5.4-mini',
    });
  });

  it('sends schema name, rules and <criteria>/<cv> blocks (no <github> without a snapshot)', async () => {
    server.use(openaiScoreHandler((body) => scoreFromRequest(body)));

    await makeScorer().score({
      criteria: CRITERIA,
      cvText: '  Jane   Doe\t\tdev\n\n\n\n\nNode  ',
    });

    const body = capture.bodies[0];
    expect(body.model).toBe(MODEL);
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'application_score',
      strict: true,
    });
    expect(messageContent(body, 'system')).toMatch(/VERBATIM/);
    expect(userOf(body)).toBe(
      [
        '<criteria>',
        'c1 [must] TypeScript experience',
        'c2 [must] REST API design',
        'c3 [nice] Docker knowledge',
        '</criteria>',
        '',
        '<cv>',
        'Jane Doe dev',
        '',
        'Node',
        '</cv>',
      ].join('\n'),
    );
  });

  it('omits <github> for non-ok snapshots', async () => {
    server.use(openaiScoreHandler((body) => scoreFromRequest(body)));

    await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
      github: snapshot({ status: 'unavailable', repos: [] }),
    });

    expect(userOf(capture.bodies[0])).not.toContain('<github>');
  });

  it('retries once with a <feedback> block after a fabricated quote and sums usage', async () => {
    server.use(
      sequence([
        fabricatedScoreResponse(IDS),
        validScoreResponse(IDS, CV_QUOTE),
      ]),
    );

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(capture.bodies).toHaveLength(2);
    const [first, second] = capture.bodies;
    expect(userOf(first)).not.toContain('<feedback>');
    expect(userOf(second)).toContain('<feedback>');
    expect(userOf(second)).toContain('not a verbatim excerpt of <cv>');
    expect(userOf(second).startsWith(userOf(first))).toBe(true);
    expect(messageContent(second, 'system')).toBe(
      messageContent(first, 'system'),
    );
    expect(result.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 400,
      model: 'gpt-5.4-mini',
    });
    expect(result.criteria[0].quotes).toEqual([CV_QUOTE]);
  });

  it('throws LlmGroundingError when the retry is still fabricated', async () => {
    server.use(sequence([fabricatedScoreResponse(IDS)]));

    const promise = makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT });
    await expect(promise).rejects.toBeInstanceOf(LlmGroundingError);
    await expect(promise).rejects.toMatchObject({
      message: 'Could not ground the score in the CV',
    });
    expect(capture.bodies).toHaveLength(2); // one retry only
  });

  it('retries when criterion ids are missing', async () => {
    server.use(
      sequence([
        validScoreResponse(['c1', 'c2'], CV_QUOTE),
        validScoreResponse(IDS, CV_QUOTE),
      ]),
    );

    await makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT });

    expect(capture.bodies).toHaveLength(2);
    expect(userOf(capture.bodies[1])).toContain('Criterion c3 is missing');
  });

  it('clamps scores, then computes the weighted overall', async () => {
    const response = validScoreResponse(IDS, CV_QUOTE);
    response.criteria[0].score = 130; // -> 100 (must)
    response.criteria[1].score = 60; // stays 60 (must)
    response.criteria[2].score = -20; // -> 0 (nice), no quotes needed
    response.criteria[2].quotes = [];
    server.use(openaiScoreHandler(response));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.criteria.map((c) => c.score)).toEqual([100, 60, 0]);
    // (100*2 + 60*2 + 0*1) / 5 = 64
    expect(result.overall).toBe(64);
  });

  it('verifies github quotes against the exact <github> block sent', async () => {
    const snap = snapshot();
    const block = buildGithubBlock(snap);
    expect(block).toContain('Alpha is a REST service built with NestJS.');
    server.use(
      openaiScoreHandler((body) => {
        expect(userOf(body)).toContain(block);
        return validScoreResponse(IDS, {
          source: 'github',
          text: 'Alpha is a REST service built with NestJS.',
        });
      }),
    );

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
      github: snap,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.criteria[0].quotes[0].source).toBe('github');
  });

  it('rejects a github quote that is not in the github block', async () => {
    server.use(
      sequence([
        validScoreResponse(IDS, {
          source: 'github',
          text: 'Rewrote the Linux kernel',
        }),
      ]),
    );

    await expect(
      makeScorer().score({
        criteria: CRITERIA,
        cvText: CV_TEXT,
        github: snapshot(),
      }),
    ).rejects.toBeInstanceOf(LlmGroundingError);
  });

  it('rejects github quotes when no github block was sent', async () => {
    server.use(
      sequence([
        validScoreResponse(IDS, {
          source: 'github',
          text: 'Alpha is a REST service built with NestJS.',
        }),
      ]),
    );

    await expect(
      makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT }),
    ).rejects.toBeInstanceOf(LlmGroundingError);
  });

  it('caps quotes per criterion at 3 and 300 characters', async () => {
    const long = 'Built REST APIs with NestJS and TypeScript';
    const cv = `${long} ${'x'.repeat(400)}`;
    const response = validScoreResponse(IDS, { source: 'cv', text: cv });
    response.criteria[0].quotes = [1, 2, 3, 4].map(() => ({
      source: 'cv' as const,
      text: cv,
    }));
    server.use(openaiScoreHandler(response));

    const result = await makeScorer().score({ criteria: CRITERIA, cvText: cv });

    expect(result.criteria[0].quotes).toHaveLength(3);
    expect(result.criteria[0].quotes[0].text).toHaveLength(300);
  });

  it('throws LlmScoreError on refusal, without retrying', async () => {
    server.use(openaiRefusalHandler('no', 'application_score'));

    const promise = makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT });
    await expect(promise).rejects.toBeInstanceOf(LlmScoreError);
    await expect(promise).rejects.not.toBeInstanceOf(LlmGroundingError);
  });

  it('throws LlmScoreError on malformed output', async () => {
    server.use(
      openaiMalformedJsonHandler('{"criteria": [', 'application_score'),
    );
    await expect(
      makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT }),
    ).rejects.toBeInstanceOf(LlmScoreError);
  });

  it('logs usage per call but never CV text', async () => {
    server.use(
      sequence([
        fabricatedScoreResponse(IDS),
        validScoreResponse(IDS, CV_QUOTE),
      ]),
    );

    await makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT });

    const usageLogs = logSpy.mock.calls.filter((c) =>
      String(c[0]).includes('LLM usage'),
    );
    expect(usageLogs).toHaveLength(2);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('Jane Doe');
  });
});

describe('ApplicationScorer.scoreRag', () => {
  const TS_CHUNK = {
    source: 'cv' as const,
    text: 'Built REST APIs with NestJS and TypeScript for 5 years.',
    similarity: 0.8,
  };
  const DOCKER_CHUNK = {
    source: 'cv' as const,
    text: 'Used Docker in CI and Kubernetes at Acme.',
    similarity: 0.7,
  };
  const REPO_CHUNK = {
    source: 'github' as const,
    text: '## alpha (language: TypeScript, stars: 50)\nAlpha is a REST service built with NestJS.',
    similarity: 0.6,
  };
  const EVIDENCE = [
    { criterionId: 'c1', chunks: [TS_CHUNK, REPO_CHUNK] },
    { criterionId: 'c2', chunks: [REPO_CHUNK, TS_CHUNK] },
    { criterionId: 'c3', chunks: [DOCKER_CHUNK] },
  ];
  const quotesByCriterion = (
    quotes: Record<string, { source: 'cv' | 'github'; text: string }>,
  ): MockScoreResponse => ({
    rationale: 'Fit based on the retrieved evidence.',
    criteria: IDS.map((criterionId) => ({
      criterionId,
      score: 80,
      reasoning: `Evidence found for ${criterionId}.`,
      quotes: [quotes[criterionId]],
    })),
  });
  const OWN_QUOTES = {
    c1: { source: 'cv' as const, text: 'Built REST APIs with NestJS' },
    c2: { source: 'github' as const, text: 'Alpha is a REST service' },
    c3: { source: 'cv' as const, text: 'Used Docker in CI' },
  };

  it('scores from the retrieved chunks and attaches them per criterion', async () => {
    server.use(openaiScoreHandler(quotesByCriterion(OWN_QUOTES)));

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    expect(capture.bodies).toHaveLength(1);
    const body = capture.bodies[0];
    expect(messageContent(body, 'system')).toMatch(/place to look first/);
    const user = userOf(body);
    expect(user).toContain(
      'c1 [must] TypeScript experience — evidence: e1, e2',
    );
    expect(user).toContain('c3 [nice] Docker knowledge — evidence: e3');
    expect(user).toContain('<evidence>');
    expect(user).not.toContain('<cv>');
    expect(result.criteria.map((c) => c.retrieved)).toEqual([
      [TS_CHUNK, REPO_CHUNK],
      [REPO_CHUNK, TS_CHUNK],
      [DOCKER_CHUNK],
    ]);
    expect(result.criteria[0]).toMatchObject({
      criterionId: 'c1',
      quotes: [OWN_QUOTES.c1],
      score: 80,
    });
    expect(result.overall).toBe(80);
    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      model: 'gpt-5.4-mini',
    });
  });

  it('accepts a quote from a chunk retrieved only for another criterion', async () => {
    const crossQuote = { ...OWN_QUOTES, c1: OWN_QUOTES.c3 };
    server.use(openaiScoreHandler(quotesByCriterion(crossQuote)));

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.criteria[0].quotes).toEqual([OWN_QUOTES.c3]);
    // retrieval stays per criterion
    expect(result.criteria[0].retrieved).toEqual([TS_CHUNK, REPO_CHUNK]);
    expect(result.criteria[2].retrieved).toEqual([DOCKER_CHUNK]);
  });

  it('retries after a quote from an unretrieved chunk, naming the problem, and sums usage', async () => {
    const unretrieved = {
      source: 'cv' as const,
      text: 'Led a team of ten engineers in Berlin',
    };
    server.use(
      sequence([
        quotesByCriterion({ ...OWN_QUOTES, c1: unretrieved }),
        quotesByCriterion(OWN_QUOTES),
      ]),
    );

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    expect(capture.bodies).toHaveLength(2);
    const [first, second] = capture.bodies;
    expect(userOf(first)).not.toContain('<feedback>');
    expect(userOf(second)).toContain('<feedback>');
    expect(userOf(second)).toContain(
      'Criterion c1: quote "Led a team of ten engineers in Berlin" is not a verbatim excerpt of <cv>',
    );
    expect(userOf(second)).toMatch(/never from text outside <evidence>/);
    expect(userOf(second).startsWith(userOf(first))).toBe(true);
    expect(messageContent(second, 'system')).toBe(
      messageContent(first, 'system'),
    );
    expect(result.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 400,
      model: 'gpt-5.4-mini',
    });
    expect(result.criteria[0].quotes).toEqual([OWN_QUOTES.c1]);
    expect(result.criteria[0].retrieved).toEqual([TS_CHUNK, REPO_CHUNK]);
  });

  it('throws LlmGroundingError after two answers quoting an unretrieved chunk', async () => {
    server.use(
      sequence([
        quotesByCriterion({
          ...OWN_QUOTES,
          c1: { source: 'cv', text: 'Led a team of ten engineers in Berlin' },
        }),
      ]),
    );

    const promise = makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });
    await expect(promise).rejects.toBeInstanceOf(LlmGroundingError);
    expect(capture.bodies).toHaveLength(2);
  });

  it('rejects a quote straddling two retrieved chunks', async () => {
    server.use(
      sequence([
        quotesByCriterion({
          ...OWN_QUOTES,
          c1: { source: 'cv', text: 'for 5 years. Used Docker in CI' },
        }),
      ]),
    );
    await expect(
      makeScorer().scoreRag({ criteria: CRITERIA, evidence: EVIDENCE }),
    ).rejects.toBeInstanceOf(LlmGroundingError);
  });

  it('verifies against the chunk text as sent (defused tags) and rejects github quotes without github chunks', async () => {
    const tagged = {
      source: 'cv' as const,
      text: 'Wrote <chunk> parsers in TypeScript',
      similarity: 0.5,
    };
    server.use(
      openaiScoreHandler(
        quotesByCriterion({
          ...OWN_QUOTES,
          c1: { source: 'cv', text: 'Wrote &lt;chunk> parsers' },
        }),
      ),
    );
    const ok = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: [{ criterionId: 'c1', chunks: [tagged] }, ...EVIDENCE.slice(1)],
    });
    expect(ok.criteria[0].retrieved).toEqual([tagged]);

    // No github chunk was retrieved for the application at all.
    server.use(
      sequence([quotesByCriterion({ ...OWN_QUOTES, c3: OWN_QUOTES.c2 })]),
    );
    await expect(
      makeScorer().scoreRag({
        criteria: CRITERIA,
        evidence: [
          { criterionId: 'c1', chunks: [TS_CHUNK] },
          { criterionId: 'c2', chunks: [TS_CHUNK] },
          { criterionId: 'c3', chunks: [DOCKER_CHUNK] },
        ],
      }),
    ).rejects.toBeInstanceOf(LlmGroundingError);
  });

  it('retries on unknown, duplicate and missing criterion ids', async () => {
    const unknown = quotesByCriterion(OWN_QUOTES);
    unknown.criteria[2].criterionId = 'c9';
    const duplicate = quotesByCriterion(OWN_QUOTES);
    duplicate.criteria[1].criterionId = 'c1';
    server.use(sequence([unknown, duplicate]));

    await expect(
      makeScorer().scoreRag({ criteria: CRITERIA, evidence: EVIDENCE }),
    ).rejects.toBeInstanceOf(LlmGroundingError);

    const second = userOf(capture.bodies[1]);
    expect(second).toContain('Unknown criterion id "c9"');
    expect(second).toContain('Criterion c3 is missing');
    expect(userOf(capture.bodies[1])).toContain('<feedback>');
  });
});
