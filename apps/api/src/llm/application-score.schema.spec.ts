import { zodTextFormat } from 'openai/helpers/zod';
import {
  APPLICATION_SCORE_SCHEMA_NAME,
  applicationScoreSchema,
} from './application-score.schema.js';

describe('applicationScoreSchema', () => {
  it('orders criterion fields so evidence comes before score', () => {
    const keys = Object.keys(
      applicationScoreSchema.shape.criteria.element.shape,
    );
    expect(keys).toEqual(['criterionId', 'evidence', 'score', 'reasoning']);
  });

  it('keeps that order in the JSON schema sent to the model', () => {
    const format = zodTextFormat(
      applicationScoreSchema,
      APPLICATION_SCORE_SCHEMA_NAME,
    );
    const criterion = (
      format.schema as {
        properties: {
          criteria: { items: { properties: Record<string, unknown> } };
        };
      }
    ).properties.criteria.items;
    expect(Object.keys(criterion.properties)).toEqual([
      'criterionId',
      'evidence',
      'score',
      'reasoning',
    ]);
  });

  it('tells the model a score above 0 needs a cited ID', () => {
    const { score } = applicationScoreSchema.shape.criteria.element.shape;
    expect(score.description).toMatch(
      /above 0 requires at least one ID in `evidence`, otherwise 0/,
    );
  });
});
