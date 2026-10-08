import { afterAll, afterEach, beforeAll } from '@jest/globals';
import { onUnhandledFrame, server } from './msw/server.js';

// Guarantees no e2e test can reach the real OpenAI API: its calls are
// answered by MSW, and any other external request fails the test.
beforeAll(() => server.listen({ onUnhandledFrame }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
