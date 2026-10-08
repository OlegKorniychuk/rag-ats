import { http, HttpResponse } from 'msw';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

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

/** Successful response whose output text is the JSON of `profile`. */
export function openaiProfileHandler(
  profile: MockProfile,
  options: {
    usage?: MockUsage;
    model?: string;
    /** Awaited before responding, to hold a request in flight. */
    before?: () => Promise<void>;
  } = {},
) {
  return http.post(OPENAI_RESPONSES_URL, async () => {
    await options.before?.();
    return HttpResponse.json(
      responseBody(
        [outputText(JSON.stringify(profile))],
        options.usage ?? DEFAULT_USAGE,
        options.model ?? 'gpt-5.4-mini',
      ),
    );
  });
}

export function openaiRefusalHandler(refusal = "I can't help with that.") {
  return http.post(OPENAI_RESPONSES_URL, () =>
    HttpResponse.json(
      responseBody(
        [{ type: 'refusal', refusal }],
        DEFAULT_USAGE,
        'gpt-5.4-mini',
      ),
    ),
  );
}

export function openaiMalformedJsonHandler(text = '{"skills": ["TypeScript"') {
  return http.post(OPENAI_RESPONSES_URL, () =>
    HttpResponse.json(
      responseBody([outputText(text)], DEFAULT_USAGE, 'gpt-5.4-mini'),
    ),
  );
}

export function openaiErrorHandler(status = 500) {
  return http.post(OPENAI_RESPONSES_URL, () =>
    HttpResponse.json(
      { error: { message: 'boom', type: 'server_error', code: null } },
      { status },
    ),
  );
}

/**
 * Records parsed JSON request bodies. Use `onRequest` via an `http.post`
 * wrapper: `server.events.on('request:start', capture.listener)`.
 */
export function captureOpenaiRequests() {
  const bodies: Array<Record<string, any>> = [];
  return {
    bodies,
    listener: async ({ request }: { request: Request }) => {
      if (request.method === 'POST' && request.url === OPENAI_RESPONSES_URL) {
        bodies.push((await request.clone().json()) as Record<string, any>);
      }
    },
  };
}
