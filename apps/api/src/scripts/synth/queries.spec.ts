import { labelQueries, validateQueries } from './queries.js';
import type { Taxonomy } from './types.js';

const persona = (id: string, tags: string[]) => ({
  id,
  skills: tags.map((tag) => ({
    tag,
    years: 1,
    evidence: 'cv_role' as const,
  })),
});

describe('labelQueries', () => {
  it('fills relevant ids and drops stale ones', () => {
    const out = labelQueries(
      [
        { id: 'q1', query: 'Kafka', tags: ['kafka'], relevant: ['old'] },
        { id: 'q2', query: 'Kafka Java', tags: ['kafka', 'java'] },
      ],
      [persona('a', ['kafka']), persona('b', ['kafka', 'java'])],
    );
    expect(out).toEqual([
      {
        id: 'q1',
        query: 'Kafka',
        tags: ['kafka'],
        relevant: ['a', 'b'],
        partiallyRelevant: [],
      },
      {
        id: 'q2',
        query: 'Kafka Java',
        tags: ['kafka', 'java'],
        relevant: ['b'],
        partiallyRelevant: [],
      },
    ]);
  });
});

describe('validateQueries', () => {
  const taxonomy: Taxonomy = {
    description: '',
    tags: [{ tag: 'kafka', label: 'Kafka', aliases: ['Kafka'] }],
  };

  it('reports unknown tags, empty tags and duplicate ids', () => {
    expect(
      validateQueries(
        [
          { id: 'q', query: '', tags: ['kafka'] },
          { id: 'q', query: '', tags: ['nope'] },
          { id: 'r', query: '', tags: [] },
        ],
        taxonomy,
      ),
    ).toEqual(['duplicate query id q', 'q: unknown tag "nope"', 'r: no tags']);
  });
});
