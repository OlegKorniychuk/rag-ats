import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const baseUrl = 'http://localhost:3000';

/**
 * Defaults: an application's interview questions were never requested. The
 * score drawer always fetches them; specs override with `server.use(...)`.
 */
export const server = setupServer(
  http.get(`${baseUrl}/applications/:id/questions`, () =>
    HttpResponse.json({
      status: null,
      error: null,
      stale: false,
      result: null,
    }),
  ),
);
