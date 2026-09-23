import request from 'supertest';
import { setupSwagger } from '../src/swagger.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

interface SecurityRequirement {
  [scheme: string]: string[];
}

interface OpenApiOperation {
  security?: SecurityRequirement[];
}

interface OpenApiDocument {
  security?: SecurityRequirement[];
  components?: { securitySchemes?: Record<string, Record<string, unknown>> };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

// An operation's own `security` (when present, even as `[]`/`[{}]`) always
// wins; only a fully absent field falls back to the document-level default.
function effectiveSecurity(
  doc: OpenApiDocument,
  op: OpenApiOperation | undefined,
): SecurityRequirement[] {
  if (!op) {
    throw new Error('operation not found in document');
  }
  return op.security ?? doc.security ?? [];
}

function requiresCookie(security: SecurityRequirement[]): boolean {
  return security.some((requirement) => 'cookie' in requirement);
}

describe('Swagger docs (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ beforeInit: setupSwagger });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  it('serves the OpenAPI document at /docs-json with the cookie scheme registered', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const doc = res.body as OpenApiDocument;
    const schemes = Object.values(doc.components?.securitySchemes ?? {});
    expect(schemes).toContainEqual(
      expect.objectContaining({
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
      }),
    );
  });

  it('requires the cookie scheme on guarded operations', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const doc = res.body as OpenApiDocument;
    expect(
      requiresCookie(effectiveSecurity(doc, doc.paths['/vacancies']?.get)),
    ).toBe(true);
    expect(
      requiresCookie(effectiveSecurity(doc, doc.paths['/auth/me']?.get)),
    ).toBe(true);
  });

  it('does not require the cookie scheme on public operations', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const doc = res.body as OpenApiDocument;
    expect(
      requiresCookie(effectiveSecurity(doc, doc.paths['/auth/login']?.post)),
    ).toBe(false);
    expect(
      requiresCookie(effectiveSecurity(doc, doc.paths['/apply/{token}']?.get)),
    ).toBe(false);
    expect(
      requiresCookie(effectiveSecurity(doc, doc.paths['/apply/{token}']?.post)),
    ).toBe(false);
  });

  it('serves the Swagger UI HTML at /docs', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/docs')
      .expect(200);

    expect(res.type).toContain('html');
  });
});
