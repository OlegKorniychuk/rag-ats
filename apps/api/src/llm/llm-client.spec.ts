import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { EnvConfig } from '../config/env.config.js';
import {
  captureOpenaiEmbeddingRequests,
  fakeEmbedding,
  OPENAI_EMBEDDINGS_URL,
  openaiEmbeddingsErrorHandler,
  openaiEmbeddingsHandler,
} from '../../test/msw/openai.handlers.js';
import { EMBEDDING_DIMENSIONS } from './embedding.constants.js';
import { EMBEDDING_BATCH_SIZE, LlmClient } from './llm-client.js';

const EMBEDDING_MODEL = 'test-embedding-model';
const server = setupServer();
const capture = captureOpenaiEmbeddingRequests();

function makeClient() {
  return new LlmClient({
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'test-model',
    OPENAI_EMBEDDING_MODEL: EMBEDDING_MODEL,
  } as EnvConfig);
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

describe('LlmClient.embed', () => {
  it('returns no vectors and makes no call for empty input', async () => {
    server.use(openaiEmbeddingsHandler());

    const result = await makeClient().embed([]);

    expect(result).toEqual({ vectors: [], usage: null });
    expect(capture.bodies).toHaveLength(0);
  });

  it('sends the configured model and the inputs', async () => {
    server.use(openaiEmbeddingsHandler());

    const { vectors } = await makeClient().embed(['alpha', 'beta']);

    expect(capture.bodies).toHaveLength(1);
    expect(capture.bodies[0].model).toBe(EMBEDDING_MODEL);
    expect(capture.bodies[0].input).toEqual(['alpha', 'beta']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vectors[0][0]).toBeCloseTo(fakeEmbedding('alpha')[0], 5);
  });

  it('batches inputs and keeps their order', async () => {
    server.use(openaiEmbeddingsHandler());
    const texts = Array.from({ length: 150 }, (_, i) => `text${i}`);

    const { vectors } = await makeClient().embed(texts);

    expect(capture.bodies.map((b) => b.input.length)).toEqual([
      EMBEDDING_BATCH_SIZE,
      50,
    ]);
    expect(vectors).toHaveLength(150);
    texts.forEach((text, i) => {
      const expected = fakeEmbedding(text);
      const bucket = expected.findIndex((x) => x > 0);
      expect(vectors[i][bucket]).toBeCloseTo(expected[bucket], 5);
    });
  });

  it('reorders a response whose data is out of order', async () => {
    const a = fakeEmbedding('first');
    const b = fakeEmbedding('second');
    server.use(
      http.post(OPENAI_EMBEDDINGS_URL, () =>
        HttpResponse.json({
          object: 'list',
          model: EMBEDDING_MODEL,
          data: [
            { object: 'embedding', index: 1, embedding: b },
            { object: 'embedding', index: 0, embedding: a },
          ],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
      ),
    );

    const { vectors } = await makeClient().embed(['first', 'second']);

    expect(vectors).toEqual([a, b]);
  });

  it('sums usage across batches and logs one line per call', async () => {
    let call = 0;
    server.use(
      http.post(OPENAI_EMBEDDINGS_URL, async ({ request }) => {
        const body = (await request.json()) as { input: string[] };
        call += 1;
        return HttpResponse.json({
          object: 'list',
          model: 'text-embedding-3-small',
          data: body.input.map((text, index) => ({
            object: 'embedding',
            index,
            embedding: fakeEmbedding(text),
          })),
          usage: { prompt_tokens: call * 10, total_tokens: call * 10 },
        });
      }),
    );

    const { usage } = await makeClient().embed(
      Array.from({ length: 101 }, (_, i) => `t${i}`),
    );

    expect(usage).toEqual({
      model: 'text-embedding-3-small',
      inputTokens: 30,
      outputTokens: 0,
      totalTokens: 30,
    });
    const lines = logSpy.mock.calls.filter((c) =>
      String(c[0]).includes('LLM usage'),
    );
    expect(lines).toHaveLength(1);
    expect(String(lines[0][0])).toBe(
      'LLM usage: model=text-embedding-3-small input_tokens=30 output_tokens=0 total_tokens=30',
    );
  });

  it('throws when a vector has the wrong dimensions', async () => {
    server.use(
      http.post(OPENAI_EMBEDDINGS_URL, () =>
        HttpResponse.json({
          object: 'list',
          model: EMBEDDING_MODEL,
          data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      ),
    );

    await expect(makeClient().embed(['x'])).rejects.toThrow(
      `Embedding has 2 dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  });

  it('propagates API errors', async () => {
    server.use(openaiEmbeddingsErrorHandler(400));

    await expect(makeClient().embed(['x'])).rejects.toThrow();
  });
});
