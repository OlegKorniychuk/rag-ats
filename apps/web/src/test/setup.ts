import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { useSessionStore } from '../auth/sessionStore';
import { server } from './server';

// findBy*/waitFor default to 1s, which flakes under full-suite CPU load
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  useSessionStore.setState(useSessionStore.getInitialState());
});
afterAll(() => server.close());
