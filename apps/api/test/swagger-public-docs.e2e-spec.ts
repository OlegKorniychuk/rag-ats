import request from 'supertest';
import { setupSwagger } from '../src/swagger.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

interface OpenApiSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, unknown>;
  $ref?: string;
}

interface OpenApiResponse {
  description?: string;
  content?: {
    'application/json'?: { schema?: OpenApiSchema };
  };
}

interface OpenApiRequestBody {
  content?: {
    'application/json'?: { schema?: OpenApiSchema };
  };
}

interface OpenApiOperation {
  tags?: string[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

function schemaRef(response: OpenApiResponse | undefined): string | undefined {
  return response?.content?.['application/json']?.schema?.$ref;
}

describe('Swagger public docs (e2e)', () => {
  let testApp: TestApp;
  let doc: OpenApiDocument;

  beforeAll(async () => {
    testApp = await createTestApp({ beforeInit: setupSwagger });

    const res = await request(testApp.app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    doc = res.body as OpenApiDocument;
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  it('documents all SubmitApplicationDto properties with the correct required set', () => {
    const schema = doc.components?.schemas?.SubmitApplicationDto;
    expect(schema).toBeDefined();

    const properties = Object.keys(schema?.properties ?? {});
    expect(properties.sort()).toEqual(
      [
        'name',
        'email',
        'skills',
        'experience',
        'projects',
        'summary',
        'githubUrl',
        'portfolioUrl',
      ].sort(),
    );

    const required = schema?.required ?? [];
    expect(required).toEqual(
      expect.arrayContaining([
        'name',
        'email',
        'skills',
        'experience',
        'projects',
        'summary',
      ]),
    );
    expect(required).not.toContain('githubUrl');
    expect(required).not.toContain('portfolioUrl');
  });

  it('documents POST /apply/{token} responses', () => {
    const operation = doc.paths['/apply/{token}']?.post;
    expect(operation).toBeDefined();

    expect(schemaRef(operation?.responses?.['201'])).toBe(
      '#/components/schemas/SuccessResponseDto',
    );
    expect(operation?.responses?.['400']).toBeDefined();
    expect(operation?.responses?.['404']).toBeDefined();
    expect(operation?.responses?.['409']).toBeDefined();
  });

  it('documents GET /apply/{token} 200 response as PublicVacancyResponseDto', () => {
    const operation = doc.paths['/apply/{token}']?.get;
    expect(operation).toBeDefined();

    expect(schemaRef(operation?.responses?.['200'])).toBe(
      '#/components/schemas/PublicVacancyResponseDto',
    );
  });

  it('documents POST /auth/register request body and 409 response', () => {
    const operation = doc.paths['/auth/register']?.post;
    expect(operation).toBeDefined();

    expect(
      operation?.requestBody?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/RegisterDto');
    expect(operation?.responses?.['409']).toBeDefined();
  });

  it('tags every operation under /auth and /apply', () => {
    for (const [path, operations] of Object.entries(doc.paths)) {
      if (!path.startsWith('/auth') && !path.startsWith('/apply')) {
        continue;
      }
      for (const operation of Object.values(operations)) {
        expect(operation.tags?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
