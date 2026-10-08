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
    'multipart/form-data'?: {
      schema?: {
        required?: string[];
        properties?: Record<string, { type?: string; format?: string }>;
      };
    };
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

  it('documents POST /apply/{token} responses', () => {
    const operation = doc.paths['/apply/{token}']?.post;
    expect(operation).toBeDefined();

    expect(schemaRef(operation?.responses?.['201'])).toBe(
      '#/components/schemas/SuccessResponseDto',
    );
    expect(operation?.responses?.['400']).toBeDefined();
    expect(operation?.responses?.['404']).toBeDefined();
    expect(operation?.responses?.['409']).toBeDefined();
    expect(operation?.responses?.['413']).toBeDefined();
  });

  it('documents POST /apply/{token} as multipart with a binary cv file', () => {
    const schema =
      doc.paths['/apply/{token}']?.post?.requestBody?.content?.[
        'multipart/form-data'
      ]?.schema;
    expect(schema?.properties?.cv).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    expect(schema?.required).toEqual(
      expect.arrayContaining(['name', 'email', 'cv']),
    );
    expect(schema?.required).not.toContain('githubUrl');
    expect(schema?.required).not.toContain('portfolioUrl');
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'cv',
      'email',
      'githubUrl',
      'name',
      'portfolioUrl',
    ]);
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
