import { setupServer } from 'msw/node';
import { HttpNetworkFrame } from 'msw/experimental';
import { githubCatchAllNotFoundHandler } from './github.handlers.js';
import {
  openaiCriteriaHandler,
  openaiProfileHandler,
  openaiScoreHandler,
  openaiUnmatchedHandler,
  scoreFromRequest,
  type MockCriterion,
  type MockProfile,
} from './openai.handlers.js';

export const DEFAULT_MOCK_PROFILE: MockProfile = {
  skills: ['TypeScript', 'NestJS'],
  experience: '5 years of backend development',
  projects: ['RAG-ATS'],
  summary: 'Backend engineer focused on TypeScript.',
};

export const DEFAULT_MOCK_CRITERIA: MockCriterion[] = [
  { text: 'Experience with TypeScript', importance: 'must' },
  { text: 'Experience building REST APIs', importance: 'must' },
  { text: 'Knowledge of Docker', importance: 'nice' },
];

/**
 * Shared server for e2e; specs override per test with `server.use(...)`.
 * GitHub answers 404 by default, so parses stay CV-only and deterministic.
 * OpenAI calls are dispatched by schema name: the default score answer quotes
 * the first 40 characters of the `<cv>` sent for every criterion id in
 * `<criteria>` (always valid); any other schema name fails with a 500.
 */
export const server = setupServer(
  openaiProfileHandler(DEFAULT_MOCK_PROFILE),
  openaiCriteriaHandler(DEFAULT_MOCK_CRITERIA),
  openaiScoreHandler((body) => scoreFromRequest(body)),
  openaiUnmatchedHandler(),
  githubCatchAllNotFoundHandler(),
);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * msw v3 `onUnhandledFrame` handler. Local traffic (supertest -> the Nest
 * server, the Docker socket) is bypassed; any other unmocked request fails,
 * so a test can never reach the real network.
 */
export const onUnhandledFrame: Extract<
  NonNullable<
    NonNullable<Parameters<typeof server.listen>[0]>['onUnhandledFrame']
  >,
  (...args: never[]) => unknown
> = ({ frame }) => {
  if (!(frame instanceof HttpNetworkFrame)) return;
  const { hostname, origin } = new URL(frame.data.request.url);
  if (LOCAL_HOSTS.has(hostname)) return;
  throw new Error(`Unmocked external request blocked by MSW: ${origin}`);
};
