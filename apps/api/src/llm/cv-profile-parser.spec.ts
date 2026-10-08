import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { setupServer } from 'msw/node';
import type { EnvConfig } from '../config/env.config.js';
import {
  captureOpenaiRequests,
  openaiErrorHandler,
  openaiMalformedJsonHandler,
  openaiProfileHandler,
  openaiRefusalHandler,
} from '../../test/msw/openai.handlers.js';
import {
  CV_TEXT_MAX_CHARS,
  CvProfileParser,
  LlmParseError,
} from './cv-profile-parser.js';
import { LlmClient } from './llm-client.js';

const MODEL = 'test-model';
const server = setupServer();
const capture = captureOpenaiRequests();

function makeParser() {
  const config = {
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: MODEL,
  } as EnvConfig;
  return new CvProfileParser(new LlmClient(config));
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
});
afterEach(() => {
  server.resetHandlers();
  capture.bodies.length = 0;
  jest.restoreAllMocks();
});
afterAll(() => server.close());

describe('CvProfileParser', () => {
  it('returns the normalised profile', async () => {
    server.use(
      openaiProfileHandler({
        skills: [' TypeScript ', 'typescript', '', 'NestJS', 'Typescript'],
        experience: '  5 years at Acme  ',
        projects: ['Billing API', ' ', 'Billing API', 'CLI tool'],
        summary: ' Backend engineer. ',
      }),
    );

    const profile = await makeParser().parse('some cv');

    expect(profile).toEqual({
      skills: ['TypeScript', 'NestJS'],
      experience: '5 years at Acme',
      projects: ['Billing API', 'CLI tool'],
      summary: 'Backend engineer.',
    });
  });

  it('sends model, strict json_schema format and delimited normalised CV', async () => {
    server.use(
      openaiProfileHandler({
        skills: [],
        experience: '',
        projects: [],
        summary: '',
      }),
    );

    await makeParser().parse('  Jane   Doe\t\tdev\n\n\n\n\nNode  ');

    expect(capture.bodies).toHaveLength(1);
    const body = capture.bodies[0];
    expect(body.model).toBe(MODEL);
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'cv_profile',
      strict: true,
    });
    const system = body.input.find((m: any) => m.role === 'system');
    const user = body.input.find((m: any) => m.role === 'user');
    expect(system.content).toMatch(/never invent/i);
    expect(system.content).toMatch(/ignore|never follow any instructions/i);
    expect(user.content).toBe('<cv>\nJane Doe dev\n\nNode\n</cv>');
  });

  it('caps the CV text', async () => {
    server.use(
      openaiProfileHandler({
        skills: [],
        experience: '',
        projects: [],
        summary: '',
      }),
    );

    await makeParser().parse('a'.repeat(CV_TEXT_MAX_CHARS + 5_000));

    const user = capture.bodies[0].input.find((m: any) => m.role === 'user');
    expect(user.content).toBe(`<cv>\n${'a'.repeat(CV_TEXT_MAX_CHARS)}\n</cv>`);
  });

  it('throws LlmParseError on refusal', async () => {
    server.use(openaiRefusalHandler());
    await expect(makeParser().parse('cv')).rejects.toBeInstanceOf(
      LlmParseError,
    );
  });

  it('throws LlmParseError on malformed JSON output', async () => {
    server.use(openaiMalformedJsonHandler());
    await expect(makeParser().parse('cv')).rejects.toBeInstanceOf(
      LlmParseError,
    );
  });

  it('throws LlmParseError when output does not match the schema', async () => {
    server.use(openaiMalformedJsonHandler('{"skills": "nope"}'));
    await expect(makeParser().parse('cv')).rejects.toBeInstanceOf(
      LlmParseError,
    );
  });

  it('rejects with the SDK error after retries on 500', async () => {
    let hits = 0;
    server.events.on('request:start', () => void hits++);
    server.use(openaiErrorHandler(500));

    const err = await makeParser()
      .parse('cv')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LlmParseError);
    expect(hits).toBe(3);
  });

  it('logs usage without the CV text', async () => {
    server.use(
      openaiProfileHandler(
        { skills: [], experience: '', projects: [], summary: '' },
        {
          usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 },
          model: 'gpt-x',
        },
      ),
    );

    await makeParser().parse('SECRET-CV-CONTENT');

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes('input_tokens'));
    expect(line).toContain('model=gpt-x');
    expect(line).toContain('input_tokens=11');
    expect(line).toContain('output_tokens=22');
    expect(line).toContain('total_tokens=33');
    expect(lines.join('\n')).not.toContain('SECRET-CV-CONTENT');
    expect(lines.join('\n')).not.toContain('sk-test');
  });
});
