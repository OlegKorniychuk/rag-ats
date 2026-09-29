import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // jsdom + MUI form tests take 1-2s; the 5s default flakes under CPU load
    testTimeout: 15_000,
    globals: false,
  },
});
