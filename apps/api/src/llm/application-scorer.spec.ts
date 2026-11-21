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
  unitsFromRequest,
  validScoreResponse,
  type MockScoreResponse,
  type OpenaiRequestBody,
} from '../../test/msw/openai.handlers.js';
import {
  ApplicationScorer,
  LlmGroundingError,
  LlmScoreError,
  MAX_GROUNDING_PROBLEMS,
  MAX_GROUNDING_PROBLEM_CHARS,
  capProblems,
  type ScoringCriterion,
} from './application-scorer.js';
import { NO_EVIDENCE_FEEDBACK } from './prompts/application-score.prompt.js';
import { LlmClient } from './llm-client.js';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import { buildGithubBlock } from './prompts/cv-profile.prompt.js';
import { normaliseText } from './cv-profile-parser.js';
import { cvUnits, githubUnits } from '../scoring/evidence-units.js';
import { citationProblems } from '../scoring/resolve-citations.js';

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
const CV_UNITS = cvUnits(normaliseText(CV_TEXT));
/** The CV unit containing `fragment`, as the scorer numbers it. */
function cvUnit(fragment: string) {
  const unit = CV_UNITS.find((u) => u.text.includes(fragment));
  if (!unit) throw new Error(`no CV unit contains ${fragment}`);
  return unit;
}
const BUILT = cvUnit('Built REST APIs');
const CV_QUOTE = { source: 'cv' as const, text: BUILT.text };

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
        validScoreResponse(IDS, BUILT.id, {
          rationale: ' Strong backend fit. ',
        }),
      ),
    );

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.attempts).toBe(1);
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

  it('resolves a cited id to that unit’s exact text', async () => {
    const docker = cvUnit('Used Docker');
    expect(docker.id).not.toBe(BUILT.id);
    server.use(openaiScoreHandler(validScoreResponse(IDS, docker.id)));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.attempts).toBe(1);
    expect(result.criteria[2].quotes).toEqual([
      { source: 'cv', text: docker.text },
    ]);
  });

  it('accepts a sloppily written id (brackets, case)', async () => {
    server.use(
      openaiScoreHandler(
        validScoreResponse(IDS, `[${BUILT.id.toLowerCase()}]`),
      ),
    );

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.attempts).toBe(1);
    expect(result.criteria[0].quotes).toEqual([CV_QUOTE]);
  });

  it('sends schema name, rules and <criteria>/<cv> unit lines (no <github> without a snapshot)', async () => {
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
    expect(messageContent(body, 'system')).toMatch(/"evidence"/);
    expect(messageContent(body, 'system')).not.toMatch(/VERBATIM/);
    expect(userOf(body)).toBe(
      [
        '<criteria>',
        'c1 [must] TypeScript experience',
        'c2 [must] REST API design',
        'c3 [nice] Docker knowledge',
        '</criteria>',
        '',
        '<cv>',
        '[S1] Jane Doe dev',
        '[S2] Node',
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

  it('retries once with a <feedback> block after an unknown id and sums usage', async () => {
    server.use(
      sequence([
        fabricatedScoreResponse(IDS),
        validScoreResponse(IDS, BUILT.id),
      ]),
    );

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(capture.bodies).toHaveLength(2);
    expect(result.attempts).toBe(2);
    const [first, second] = capture.bodies;
    expect(userOf(first)).not.toContain('<feedback>');
    expect(userOf(second)).toContain('<feedback>');
    expect(userOf(second)).toContain(
      citationProblems.unknownEvidence('c1', 'S999'),
    );
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

  it('throws LlmGroundingError when the retry still cites unknown ids', async () => {
    server.use(sequence([fabricatedScoreResponse(IDS)]));

    const promise = makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT });
    await expect(promise).rejects.toBeInstanceOf(LlmGroundingError);
    await expect(promise).rejects.toMatchObject({
      message: 'Could not ground the score in the CV',
    });
    expect(capture.bodies).toHaveLength(2); // one retry only
  });

  it('carries the second attempt’s resolver problems on the LlmGroundingError, and keeps them out of the log', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    server.use(
      sequence([
        fabricatedScoreResponse(IDS),
        // c3 missing, c1/c2 unknown: differs from the first attempt
        validScoreResponse(['c1', 'c2'], 'S888'),
      ]),
    );

    const error = await makeScorer()
      .score({ criteria: CRITERIA, cvText: CV_TEXT })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmGroundingError);
    expect((error as LlmGroundingError).problems).toEqual([
      citationProblems.unknownEvidence('c1', 'S888'),
      citationProblems.unknownEvidence('c2', 'S888'),
      citationProblems.missingCriterion('c3'),
    ]);
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('problems=3');
    expect(logged).toContain('details stored on the score row');
    expect(logged).not.toContain('S888');
  });

  it('caps the stored problems of a grounding failure', async () => {
    const response = fabricatedScoreResponse(IDS);
    // 25 unknown criterion ids: 25 more problems on top of the 3 unknown ids
    for (let i = 0; i < 25; i++) {
      response.criteria.push({
        ...response.criteria[0],
        criterionId: `unknown-${i}`,
      });
    }
    server.use(sequence([response]));

    const error = await makeScorer()
      .score({ criteria: CRITERIA, cvText: CV_TEXT })
      .catch((e: unknown) => e);

    expect((error as LlmGroundingError).problems).toHaveLength(
      MAX_GROUNDING_PROBLEMS,
    );
  });

  it('truncates every stored problem to a bounded length', () => {
    const capped = capProblems(['a'.repeat(2000), 'short']);

    expect(capped[0]).toHaveLength(MAX_GROUNDING_PROBLEM_CHARS);
    expect(capped[1]).toBe('short');
    expect(new LlmGroundingError().problems).toEqual([]);
  });

  it('retries when criterion ids are missing', async () => {
    server.use(
      sequence([
        validScoreResponse(['c1', 'c2'], BUILT.id),
        validScoreResponse(IDS, BUILT.id),
      ]),
    );

    await makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT });

    expect(capture.bodies).toHaveLength(2);
    expect(userOf(capture.bodies[1])).toContain('Criterion c3 is missing');
  });

  it('retries when a score above 0 cites nothing', async () => {
    const empty = validScoreResponse(IDS, BUILT.id);
    empty.criteria[1].evidence = [];
    server.use(sequence([empty, validScoreResponse(IDS, BUILT.id)]));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.attempts).toBe(2);
    expect(result.zeroedCriteria).toEqual([]);
    expect(result.criteria.map((c) => c.score)).toEqual([80, 80, 80]);
    expect(userOf(capture.bodies[1])).toContain(
      citationProblems.noEvidence('c2'),
    );
    expect(userOf(capture.bodies[1])).toContain(NO_EVIDENCE_FEEDBACK);
  });

  it('sets a score above 0 that still cites nothing on the retry to 0, with a note', async () => {
    const empty = validScoreResponse(IDS, BUILT.id);
    empty.criteria[1].evidence = [];
    empty.criteria[1].reasoning = ' Looks like REST experience. ';
    server.use(sequence([empty]));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(capture.bodies).toHaveLength(2);
    expect(userOf(capture.bodies[1])).toContain(NO_EVIDENCE_FEEDBACK);
    expect(result.attempts).toBe(2);
    expect(result.zeroedCriteria).toEqual(['c2']);
    expect(result.criteria.map((c) => c.score)).toEqual([80, 0, 80]);
    expect(result.criteria[1].reasoning).toBe(
      'Looks like REST experience. (Score set to 0: no evidence was cited.)',
    );
    expect(result.criteria[1].quotes).toEqual([]);
    // untouched criteria keep their reasoning
    expect(result.criteria[0].reasoning).toBe('Evidence found for c1.');
    // (80*2 + 0*2 + 80*1) / 5 = 48
    expect(result.overall).toBe(48);
  });

  it('does not zero when the retry fixes the citation', async () => {
    const empty = validScoreResponse(IDS, BUILT.id);
    empty.criteria[0].evidence = [];
    server.use(sequence([empty, validScoreResponse(IDS, BUILT.id)]));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.zeroedCriteria).toEqual([]);
    expect(result.criteria[0].reasoning).toBe('Evidence found for c1.');
  });

  it('reports no zeroed criteria when the first answer is proven', async () => {
    server.use(openaiScoreHandler(validScoreResponse(IDS, BUILT.id)));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.attempts).toBe(1);
    expect(result.zeroedCriteria).toEqual([]);
  });

  it('does not zero or annotate a score that is 0 already', async () => {
    const response = validScoreResponse(IDS, BUILT.id);
    response.criteria[2].score = 0;
    response.criteria[2].evidence = [];
    server.use(openaiScoreHandler(response));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.zeroedCriteria).toEqual([]);
    expect(result.criteria[2].reasoning).toBe('Evidence found for c3.');
  });

  it('still throws when the final attempt has another problem next to a zeroing', async () => {
    const empty = validScoreResponse(IDS, BUILT.id);
    empty.criteria[1].evidence = [];
    const unknown = validScoreResponse(IDS, BUILT.id);
    unknown.criteria[1].evidence = [];
    unknown.criteria[2].evidence = ['S999'];
    server.use(sequence([empty, unknown]));

    const error = await makeScorer()
      .score({ criteria: CRITERIA, cvText: CV_TEXT })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmGroundingError);
    expect((error as LlmGroundingError).problems).toEqual([
      citationProblems.unknownEvidence('c3', 'S999'),
    ]);
  });

  it('clamps scores, then computes the weighted overall', async () => {
    const response = validScoreResponse(IDS, BUILT.id);
    response.criteria[0].score = 130; // -> 100 (must)
    response.criteria[1].score = 60; // stays 60 (must)
    response.criteria[2].score = -20; // -> 0 (nice), no citation needed
    response.criteria[2].evidence = [];
    server.use(openaiScoreHandler(response));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.criteria.map((c) => c.score)).toEqual([100, 60, 0]);
    expect(result.criteria[2].quotes).toEqual([]);
    // (100*2 + 60*2 + 0*1) / 5 = 64
    expect(result.overall).toBe(64);
  });

  it('resolves github ids against the exact <github> block sent', async () => {
    const snap = snapshot();
    const block = buildGithubBlock(snap);
    const readme = githubUnits(block).find((u) =>
      u.text.includes('Alpha is a REST service built with NestJS.'),
    )!;
    expect(readme.id).toMatch(/^G\d+$/);
    server.use(
      openaiScoreHandler((body) => {
        expect(userOf(body)).toContain(`[${readme.id}] ${readme.text}`);
        return validScoreResponse(IDS, readme.id);
      }),
    );

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
      github: snap,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.criteria[0].quotes).toEqual([
      { source: 'github', text: readme.text },
    ]);
  });

  it('rejects a github id that is not in the github block', async () => {
    server.use(sequence([validScoreResponse(IDS, 'G999')]));

    await expect(
      makeScorer().score({
        criteria: CRITERIA,
        cvText: CV_TEXT,
        github: snapshot(),
      }),
    ).rejects.toBeInstanceOf(LlmGroundingError);
  });

  it('rejects github ids when no github block was sent', async () => {
    server.use(sequence([validScoreResponse(IDS, 'G1')]));

    await expect(
      makeScorer().score({ criteria: CRITERIA, cvText: CV_TEXT }),
    ).rejects.toBeInstanceOf(LlmGroundingError);
  });

  it('keeps at most 3 cited units per criterion, dropping repeats', async () => {
    const response = validScoreResponse(IDS, BUILT.id);
    response.criteria[0].evidence = ['S1', 'S2', 'S2', 'S3', 'S4'];
    server.use(openaiScoreHandler(response));

    const result = await makeScorer().score({
      criteria: CRITERIA,
      cvText: CV_TEXT,
    });

    expect(result.criteria[0].quotes.map((q) => q.text)).toEqual(
      CV_UNITS.slice(0, 3).map((u) => u.text),
    );
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
        validScoreResponse(IDS, BUILT.id),
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

  /** The id the request shows for the unit whose text contains `fragment`. */
  const idOf = (body: OpenaiRequestBody, fragment: string): string => {
    const unit = [...unitsFromRequest(body).values()].find((u) =>
      u.text.includes(fragment),
    );
    if (!unit) throw new Error(`no unit shows ${fragment}`);
    return unit.id;
  };
  /** A response citing, per criterion, the unit of the request containing its fragment. */
  const citing =
    (fragments: Record<string, string>) =>
    (body: OpenaiRequestBody): MockScoreResponse => ({
      rationale: 'Fit based on the retrieved evidence.',
      criteria: IDS.map((criterionId) => ({
        criterionId,
        score: 80,
        reasoning: `Evidence found for ${criterionId}.`,
        evidence: [idOf(body, fragments[criterionId])],
      })),
    });
  const OWN = {
    c1: 'Built REST APIs',
    c2: 'Alpha is a REST service',
    c3: 'Used Docker in CI',
  };

  it('zeroes a criterion that still cites nothing on the retry', async () => {
    server.use(
      openaiScoreHandler((body) => {
        const response = citing(OWN)(body);
        response.criteria[0].evidence = [];
        return response;
      }),
    );

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    expect(capture.bodies).toHaveLength(2);
    expect(userOf(capture.bodies[1])).toContain(NO_EVIDENCE_FEEDBACK);
    expect(result.attempts).toBe(2);
    expect(result.zeroedCriteria).toEqual(['c1']);
    expect(result.criteria[0].score).toBe(0);
    expect(result.criteria[0].reasoning).toBe(
      'Evidence found for c1. (Score set to 0: no evidence was cited.)',
    );
    expect(result.criteria[0].retrieved).toEqual([TS_CHUNK, REPO_CHUNK]);
    // (0*2 + 80*2 + 80*1) / 5 = 48
    expect(result.overall).toBe(48);
  });

  it('scores from the retrieved chunks and attaches them per criterion', async () => {
    server.use(openaiScoreHandler(citing(OWN)));

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.attempts).toBe(1);
    const body = capture.bodies[0];
    expect(messageContent(body, 'system')).toMatch(/place to look first/);
    const user = userOf(body);
    expect(user).toContain(
      'c1 [must] TypeScript experience — evidence: e1, e2',
    );
    expect(user).toContain('c3 [nice] Docker knowledge — evidence: e3');
    expect(user).toContain('<evidence>');
    expect(user).toContain(
      '<chunk id="e1" source="cv">\n[S1] Built REST APIs with NestJS and TypeScript for 5 years.\n</chunk>',
    );
    expect(user).not.toContain('<cv>');
    expect(result.criteria.map((c) => c.retrieved)).toEqual([
      [TS_CHUNK, REPO_CHUNK],
      [REPO_CHUNK, TS_CHUNK],
      [DOCKER_CHUNK],
    ]);
    expect(result.criteria[0]).toMatchObject({
      criterionId: 'c1',
      quotes: [{ source: 'cv', text: TS_CHUNK.text }],
      score: 80,
    });
    expect(result.overall).toBe(80);
    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      model: 'gpt-5.4-mini',
    });
  });

  it('resolves a unit shown in the prompt: the id the model sees is the id that resolves', async () => {
    server.use(openaiScoreHandler(citing(OWN)));

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    const shown = unitsFromRequest(capture.bodies[0]);
    expect(shown.size).toBeGreaterThan(0);
    // c3 cites the Docker unit by the id the prompt printed for it
    const docker = [...shown.values()].find((u) => u.text.includes('Docker'))!;
    expect(result.criteria[2].quotes).toEqual([
      { source: 'cv', text: docker.text },
    ]);
    expect(result.attempts).toBe(1);
  });

  it('resolves a G unit from a github chunk with source github', async () => {
    server.use(openaiScoreHandler(citing(OWN)));

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    const [quote] = result.criteria[1].quotes;
    expect(quote).toEqual({
      source: 'github',
      text: 'Alpha is a REST service built with NestJS.',
    });
    expect(userOf(capture.bodies[0])).toMatch(
      /<chunk id="e2" source="github">/,
    );
  });

  it('accepts a unit from a chunk retrieved only for another criterion', async () => {
    server.use(openaiScoreHandler(citing({ ...OWN, c1: OWN.c3 })));

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(result.criteria[0].quotes).toEqual([
      { source: 'cv', text: DOCKER_CHUNK.text },
    ]);
    // retrieval stays per criterion
    expect(result.criteria[0].retrieved).toEqual([TS_CHUNK, REPO_CHUNK]);
    expect(result.criteria[2].retrieved).toEqual([DOCKER_CHUNK]);
  });

  it('retries after an id of an unretrieved unit, naming the problem, and sums usage', async () => {
    let call = 0;
    server.use(
      openaiScoreHandler((body) => {
        const response = citing(OWN)(body);
        if (call++ === 0) response.criteria[0].evidence = ['S77'];
        return response;
      }),
    );

    const result = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });

    expect(capture.bodies).toHaveLength(2);
    expect(result.attempts).toBe(2);
    const [first, second] = capture.bodies;
    expect(userOf(first)).not.toContain('<feedback>');
    expect(userOf(second)).toContain('<feedback>');
    expect(userOf(second)).toContain(
      citationProblems.unknownEvidence('c1', 'S77'),
    );
    expect(userOf(second)).toMatch(/Cite only IDs shown in <evidence>/);
    expect(userOf(second).startsWith(userOf(first))).toBe(true);
    expect(messageContent(second, 'system')).toBe(
      messageContent(first, 'system'),
    );
    expect(result.usage).toEqual({
      inputTokens: 2400,
      outputTokens: 600,
      model: 'gpt-5.4-mini',
    });
    expect(result.criteria[0].quotes).toEqual([
      { source: 'cv', text: TS_CHUNK.text },
    ]);
    expect(result.criteria[0].retrieved).toEqual([TS_CHUNK, REPO_CHUNK]);
  });

  it('throws LlmGroundingError after two answers citing an unretrieved unit', async () => {
    server.use(sequence([validScoreResponse(IDS, 'S77')]));

    const promise = makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: EVIDENCE,
    });
    await expect(promise).rejects.toBeInstanceOf(LlmGroundingError);
    await expect(promise).rejects.toMatchObject({
      problems: [
        citationProblems.unknownEvidence('c1', 'S77'),
        citationProblems.unknownEvidence('c2', 'S77'),
        citationProblems.unknownEvidence('c3', 'S77'),
      ],
    });
    expect(capture.bodies).toHaveLength(2);
  });

  it('cites units of the chunk text as sent (defused tags)', async () => {
    const tagged = {
      source: 'cv' as const,
      text: 'Wrote <chunk> parsers in TypeScript',
      similarity: 0.5,
    };
    server.use(
      openaiScoreHandler(citing({ ...OWN, c1: 'Wrote &lt;chunk> parsers' })),
    );
    const ok = await makeScorer().scoreRag({
      criteria: CRITERIA,
      evidence: [{ criterionId: 'c1', chunks: [tagged] }, ...EVIDENCE.slice(1)],
    });
    expect(ok.criteria[0].retrieved).toEqual([tagged]);
    expect(ok.criteria[0].quotes).toEqual([
      { source: 'cv', text: 'Wrote &lt;chunk> parsers in TypeScript' },
    ]);
  });

  it('rejects a G id when no github chunk was retrieved', async () => {
    server.use(sequence([validScoreResponse(IDS, 'G1')]));
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
    const good = (body: OpenaiRequestBody) => citing(OWN)(body);
    let unknown: MockScoreResponse | undefined;
    let duplicate: MockScoreResponse | undefined;
    let call = 0;
    server.use(
      openaiScoreHandler((body) => {
        if (call++ === 0) {
          unknown = good(body);
          unknown.criteria[2].criterionId = 'c9';
          return unknown;
        }
        duplicate = good(body);
        duplicate.criteria[1].criterionId = 'c1';
        return duplicate;
      }),
    );

    await expect(
      makeScorer().scoreRag({ criteria: CRITERIA, evidence: EVIDENCE }),
    ).rejects.toBeInstanceOf(LlmGroundingError);

    const second = userOf(capture.bodies[1]);
    expect(second).toContain('Unknown criterion id "c9"');
    expect(second).toContain('Criterion c3 is missing');
    expect(second).toContain('<feedback>');
  });
});
