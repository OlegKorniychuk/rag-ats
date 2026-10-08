import { setupServer } from 'msw/node';
import { HttpNetworkFrame } from 'msw/experimental';
import { openaiProfileHandler, type MockProfile } from './openai.handlers.js';

export const DEFAULT_MOCK_PROFILE: MockProfile = {
  skills: ['TypeScript', 'NestJS'],
  experience: '5 years of backend development',
  projects: ['RAG-ATS'],
  summary: 'Backend engineer focused on TypeScript.',
};

/** Shared server for e2e; specs override per test with `server.use(...)`. */
export const server = setupServer(openaiProfileHandler(DEFAULT_MOCK_PROFILE));

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
