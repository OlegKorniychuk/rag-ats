import { http, HttpResponse } from 'msw';
import { APPLICATION_SCORE_SCHEMA_NAME } from '../../src/llm/application-score.schema.js';
import { CV_PROFILE_SCHEMA_NAME } from '../../src/llm/cv-profile.schema.js';
import { VACANCY_CRITERIA_SCHEMA_NAME } from '../../src/llm/vacancy-criteria.schema.js';
import { EMBEDDING_DIMENSIONS } from '../../src/llm/embedding.constants.js';
import { normaliseForMatch } from '../../src/scoring/verify-quotes.js';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export interface MockProfile {
  skills: string[];
  experience: string;
  projects: string[];
  summary: string;
}

export interface MockUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export type OpenaiRequestBody = Record<string, any>;

export interface MockCriterion {
  text: string;
  importance: 'must' | 'nice';
}

export interface MockQuote {
  source: 'cv' | 'github';
  text: string;
}

export interface MockCriterionScore {
  criterionId: string;
  score: number;
  reasoning: string;
  quotes: MockQuote[];
}

export interface MockScoreResponse {
  criteria: MockCriterionScore[];
  rationale: string;
}

const DEFAULT_USAGE: MockUsage = {
  input_tokens: 1200,
  output_tokens: 300,
  total_tokens: 1500,
};

function responseBody(
  content: Array<Record<string, unknown>>,
  usage: MockUsage | null,
  model: string,
) {
  return {
    id: 'resp_test',
    object: 'response',
    created_at: 1_700_000_000,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model,
    output: [
      {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content,
      },
    ],
    parallel_tool_calls: true,
    temperature: 1,
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    usage: usage && {
      ...usage,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

const outputText = (text: string) => ({
  type: 'output_text',
  text,
  annotations: [],
});

const DEFAULT_MODEL = 'gpt-5.4-mini';

interface HandlerOptions {
  usage?: MockUsage;
  model?: string;
  /** Awaited before responding, to hold a request in flight. */
  before?: () => Promise<void>;
}

/** The structured-output schema name a request asks for (`text.format.name`). */
export function schemaNameOf(body: OpenaiRequestBody): string | undefined {
  return body?.text?.format?.name;
}

/** Text of a message of the request, by role (string content only). */
export function messageContent(
  body: OpenaiRequestBody,
  role: 'system' | 'user',
): string {
  const message = (body.input as Array<Record<string, any>>).find(
    (m) => m.role === role,
  );
  return typeof message?.content === 'string' ? message.content : '';
}

/** Content of `<tag>…</tag>` in a prompt, or null. */
export function extractTag(content: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(content);
  return match ? match[1] : null;
}

/**
 * Handler for POST /v1/responses requests whose `text.format.name` equals
 * `schemaName` (`null` matches every schema). Non-matching requests fall
 * through to the next handler. The resolver gets the parsed request body.
 */
export function openaiSchemaHandler(
  schemaName: string | null,
  resolver: (
    body: OpenaiRequestBody,
  ) => Response | undefined | Promise<Response | undefined>,
) {
  return http.post(OPENAI_RESPONSES_URL, async ({ request }) => {
    const body = (await request.clone().json()) as OpenaiRequestBody;
    if (schemaName !== null && schemaNameOf(body) !== schemaName) {
      return undefined;
    }
    return resolver(body);
  });
}

function jsonOutput(payload: unknown, options: HandlerOptions = {}): Response {
  return HttpResponse.json(
    responseBody(
      [outputText(JSON.stringify(payload))],
      options.usage ?? DEFAULT_USAGE,
      options.model ?? DEFAULT_MODEL,
    ),
  );
}

/** Successful `cv_profile` response whose output text is the JSON of `profile`. */
export function openaiProfileHandler(
  profile: MockProfile,
  options: HandlerOptions = {},
) {
  return openaiSchemaHandler(CV_PROFILE_SCHEMA_NAME, async () => {
    await options.before?.();
    return jsonOutput(profile, options);
  });
}

/** Successful `vacancy_criteria` response. */
export function openaiCriteriaHandler(
  criteria: MockCriterion[],
  options: HandlerOptions = {},
) {
  return openaiSchemaHandler(VACANCY_CRITERIA_SCHEMA_NAME, async () => {
    await options.before?.();
    return jsonOutput({ criteria }, options);
  });
}

/**
 * Successful `application_score` response. Pass a fixed response, or a
 * function of the parsed request body (e.g. built with `scoreFromRequest`)
 * to derive quotes from the CV text actually sent.
 */
export function openaiScoreHandler(
  response:
    MockScoreResponse | ((body: OpenaiRequestBody) => MockScoreResponse),
  options: HandlerOptions = {},
) {
  return openaiSchemaHandler(APPLICATION_SCORE_SCHEMA_NAME, async (body) => {
    await options.before?.();
    return jsonOutput(
      typeof response === 'function' ? response(body) : response,
      options,
    );
  });
}

/** Criterion ids listed in the `<criteria>` block of a score request. */
export function criterionIdsFromRequest(body: OpenaiRequestBody): string[] {
  const block = extractTag(messageContent(body, 'user'), 'criteria') ?? '';
  return block
    .split('\n')
    .map((line) => /^(\S+) \[(?:must|nice)\]/.exec(line)?.[1])
    .filter((id): id is string => !!id);
}

/** Content of `<cv>` (or `<github>`) in a score request, as the model saw it. */
export function sourceFromRequest(
  body: OpenaiRequestBody,
  source: 'cv' | 'github',
): string | null {
  return extractTag(messageContent(body, 'user'), source);
}

/** A valid score response: one entry per id, each carrying `quote`. */
export function validScoreResponse(
  criterionIds: string[],
  quote: MockQuote,
  options: { score?: number; rationale?: string } = {},
): MockScoreResponse {
  return {
    criteria: criterionIds.map((criterionId) => ({
      criterionId,
      score: options.score ?? 80,
      reasoning: `Evidence found for ${criterionId}.`,
      quotes: [quote],
    })),
    rationale: options.rationale ?? 'Solid match based on the CV.',
  };
}

/** A response whose quote appears nowhere in the CV: fails verification. */
export function fabricatedScoreResponse(
  criterionIds: string[],
  options: { score?: number } = {},
): MockScoreResponse {
  return validScoreResponse(
    criterionIds,
    {
      source: 'cv',
      text: 'Led a team of 40 engineers at Imaginary Corp Ltd',
    },
    options,
  );
}

/** Valid response quoting the first `chars` characters of the `<cv>` sent. */
export function scoreFromRequest(
  body: OpenaiRequestBody,
  options: { score?: number; chars?: number } = {},
): MockScoreResponse {
  const cv = sourceFromRequest(body, 'cv') ?? '';
  const text = normaliseForMatch(cv)
    .slice(0, options.chars ?? 40)
    .trim();
  return validScoreResponse(
    criterionIdsFromRequest(body),
    { source: 'cv', text },
    options,
  );
}

/** Refusal for requests of `schemaName` (default `cv_profile`; `null` = any). */
export function openaiRefusalHandler(
  refusal = "I can't help with that.",
  schemaName: string | null = CV_PROFILE_SCHEMA_NAME,
) {
  return openaiSchemaHandler(schemaName, () =>
    HttpResponse.json(
      responseBody(
        [{ type: 'refusal', refusal }],
        DEFAULT_USAGE,
        DEFAULT_MODEL,
      ),
    ),
  );
}

/** Unparseable output for requests of `schemaName` (default `cv_profile`; `null` = any). */
export function openaiMalformedJsonHandler(
  text = '{"skills": ["TypeScript"',
  schemaName: string | null = CV_PROFILE_SCHEMA_NAME,
) {
  return openaiSchemaHandler(schemaName, () =>
    HttpResponse.json(
      responseBody([outputText(text)], DEFAULT_USAGE, DEFAULT_MODEL),
    ),
  );
}

/** HTTP error for requests of `schemaName` (default: every schema, i.e. OpenAI is down). */
export function openaiErrorHandler(
  status = 500,
  schemaName: string | null = null,
) {
  return openaiSchemaHandler(schemaName, () =>
    HttpResponse.json(
      { error: { message: 'boom', type: 'server_error', code: null } },
      { status },
    ),
  );
}

/** Last-resort handler: an OpenAI call no test mocked fails loudly with a 500. */
export function openaiUnmatchedHandler() {
  return http.post('https://api.openai.com/v1/*', async ({ request }) => {
    const what =
      request.url === OPENAI_EMBEDDINGS_URL
        ? 'embeddings'
        : `schema "${schemaNameOf((await request.clone().json()) as OpenaiRequestBody) ?? 'unknown'}"`;
    return HttpResponse.json(
      {
        error: {
          message: `No MSW handler for OpenAI ${what}`,
          type: 'server_error',
          code: null,
        },
      },
      { status: 500 },
    );
  });
}

/**
 * Records parsed JSON request bodies:
 * `server.events.on('request:start', capture.listener)`. With `schemaName`
 * only requests for that schema are kept.
 */
export function captureOpenaiRequests(schemaName?: string) {
  const bodies: OpenaiRequestBody[] = [];
  return {
    bodies,
    listener: async ({ request }: { request: Request }) => {
      if (request.method === 'POST' && request.url === OPENAI_RESPONSES_URL) {
        const body = (await request.clone().json()) as OpenaiRequestBody;
        if (schemaName === undefined || schemaNameOf(body) === schemaName) {
          bodies.push(body);
        }
      }
    },
  };
}

/** Like `captureOpenaiRequests`, for POST /v1/embeddings requests. */
export function captureOpenaiEmbeddingRequests() {
  const bodies: OpenaiRequestBody[] = [];
  return {
    bodies,
    listener: async ({ request }: { request: Request }) => {
      if (request.method === 'POST' && request.url === OPENAI_EMBEDDINGS_URL) {
        bodies.push((await request.clone().json()) as OpenaiRequestBody);
      }
    },
  };
}

// ---------- Embeddings ----------

const EMBEDDING_MODEL = 'text-embedding-3-small';

function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Deterministic fake embedding: a hashed bag of lowercase words, L2-normalised.
 * Cosine similarity then tracks keyword overlap, so tests can assert relevance.
 */
export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    vector[0] = 1;
    return vector;
  }
  for (const token of tokens) vector[fnv1a(token) % EMBEDDING_DIMENSIONS] += 1;
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return vector.map((x) => x / norm);
}

function float32Base64(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString('base64');
}

/** Successful POST /v1/embeddings: `fakeEmbedding` of every input, in order. */
export function openaiEmbeddingsHandler(options: HandlerOptions = {}) {
  return http.post(OPENAI_EMBEDDINGS_URL, async ({ request }) => {
    const body = (await request.clone().json()) as OpenaiRequestBody;
    await options.before?.();
    const inputs: string[] = Array.isArray(body.input)
      ? body.input
      : [body.input];
    // The SDK asks for base64 unless the caller picked an encoding.
    const base64 = body.encoding_format === 'base64';
    const tokens = inputs.reduce(
      (sum, text) => sum + text.split(/\s+/).filter(Boolean).length,
      0,
    );
    return HttpResponse.json({
      object: 'list',
      data: inputs.map((text, index) => {
        const embedding = fakeEmbedding(text);
        return {
          object: 'embedding',
          index,
          embedding: base64 ? float32Base64(embedding) : embedding,
        };
      }),
      model: options.model ?? EMBEDDING_MODEL,
      usage: { prompt_tokens: tokens, total_tokens: tokens },
    });
  });
}

/** HTTP error for every POST /v1/embeddings request. */
export function openaiEmbeddingsErrorHandler(status = 500) {
  return http.post(OPENAI_EMBEDDINGS_URL, () =>
    HttpResponse.json(
      { error: { message: 'boom', type: 'server_error', code: null } },
      { status },
    ),
  );
}
