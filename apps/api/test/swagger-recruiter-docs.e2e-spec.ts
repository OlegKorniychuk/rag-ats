import request from 'supertest';
import { setupSwagger } from '../src/swagger.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

interface OpenApiSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, unknown>;
  items?: OpenApiSchema;
  enum?: string[];
  $ref?: string;
}

interface OpenApiResponse {
  description?: string;
  content?: {
    'application/json'?: { schema?: OpenApiSchema };
  };
}

interface OpenApiOperation {
  tags?: string[];
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

function responseSchema(
  operation: OpenApiOperation | undefined,
  status: string,
): OpenApiSchema | undefined {
  return operation?.responses?.[status]?.content?.['application/json']?.schema;
}

// Resolves a $ref against components.schemas, one level deep.
function resolveRef(
  doc: OpenApiDocument,
  schema: OpenApiSchema | undefined,
): OpenApiSchema | undefined {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  return doc.components?.schemas?.[name];
}

describe('Swagger recruiter docs (e2e)', () => {
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

  it('documents GET /vacancies 200 as an array of VacancyResponseDto', () => {
    const operation = doc.paths['/vacancies']?.get;
    const schema = responseSchema(operation, '200');
    expect(schema?.type).toBe('array');
    expect(schema?.items?.$ref).toBe('#/components/schemas/VacancyResponseDto');
  });

  it('documents GET /vacancies/{id}/applications 200 items as ApplicationWithCandidateResponseDto with a candidate property', () => {
    const operation = doc.paths['/vacancies/{id}/applications']?.get;
    const schema = responseSchema(operation, '200');
    expect(schema?.type).toBe('array');
    expect(schema?.items?.$ref).toBe(
      '#/components/schemas/ApplicationWithCandidateResponseDto',
    );

    const itemSchema = resolveRef(doc, schema?.items);
    const candidateProperty = itemSchema?.properties?.candidate as
      OpenApiSchema | undefined;
    expect(candidateProperty?.$ref).toBe(
      '#/components/schemas/CandidateResponseDto',
    );
  });

  it("documents UpdateApplicationDto's stage enum from applicationStageEnum", () => {
    const schema = doc.components?.schemas?.UpdateApplicationDto;
    expect(
      (schema?.properties?.stage as OpenApiSchema | undefined)?.enum,
    ).toEqual(['applied', 'screened', 'interview', 'rejected', 'hired']);
  });

  it('documents PATCH /applications/{id} responses', () => {
    const operation = doc.paths['/applications/{id}']?.patch;
    expect(operation).toBeDefined();

    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['400']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.responses?.['404']).toBeDefined();
  });

  it('documents GET /candidates/{id} 200 response as CandidateResponseDto', () => {
    const operation = doc.paths['/candidates/{id}']?.get;
    const schema = responseSchema(operation, '200');
    expect(schema?.$ref).toBe('#/components/schemas/CandidateResponseDto');
  });

  it('tags every operation under /vacancies, /applications and /candidates', () => {
    for (const [path, operations] of Object.entries(doc.paths)) {
      if (
        !path.startsWith('/vacancies') &&
        !path.startsWith('/applications') &&
        !path.startsWith('/candidates')
      ) {
        continue;
      }
      for (const operation of Object.values(operations)) {
        expect(operation.tags?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
