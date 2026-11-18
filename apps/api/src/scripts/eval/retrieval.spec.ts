import type { VacancyCriterion } from '@rag-ats/shared';
import {
  CandidateSearchService,
  type CandidateSearchTrace,
} from '../../candidates/search/candidate-search.service.js';
import type { ChunkHit } from '../../db/repositories/candidate-chunks.repository.js';
import type { Candidate } from '../../db/repositories/candidates.repository.js';
import type { LlmClient } from '../../llm/llm-client.js';
import type { PersonaSpec, VacancySpec } from '../synth/types.js';
import type { EvalDataset } from './preflight.js';
import { retrieveAll, type RetrievalDeps } from './retrieval.js';
import { G5_EXAMPLES, type MatchDeps } from './retrieval-matches.js';
import { evaluateSearch } from './retrieval-search.js';

const hit = (
  candidateId: string,
  similarity: number,
  text = `chunk of ${candidateId}`,
): ChunkHit => ({ candidateId, source: 'cv', text, similarity });

/** Fake embedder + chunk repository: a text's vector is its registry index. */
class FakeIndex {
  readonly embedCalls: string[][] = [];
  readonly nearestCalls: Array<{ text: string; limit: number; args: number }> =
    [];
  private readonly registry: string[] = [];
  private readonly hitsByText = new Map<string, ChunkHit[]>();

  /** The nearest chunks the index returns for a text (best first). */
  on(text: string, hits: ChunkHit[]): this {
    this.hitsByText.set(text, hits);
    return this;
  }

  embed = (texts: string[]): Promise<number[][]> => {
    this.embedCalls.push(texts);
    return Promise.resolve(
      texts.map((t) => {
        let i = this.registry.indexOf(t);
        if (i === -1) i = this.registry.push(t) - 1;
        return [i];
      }),
    );
  };

  findNearest = (
    vector: number[],
    limit: number,
    ...rest: unknown[]
  ): Promise<ChunkHit[]> => {
    const text = this.registry[vector[0]];
    this.nearestCalls.push({ text, limit, args: 2 + rest.length });
    return Promise.resolve((this.hitsByText.get(text) ?? []).slice(0, limit));
  };

  asLlm(): LlmClient {
    return {
      embed: async (texts: string[]) => ({
        vectors: await this.embed(texts),
        usage: null,
        model: 'fake',
      }),
    } as unknown as LlmClient;
  }

  get matchDeps(): MatchDeps {
    return { embed: this.embed, findNearest: this.findNearest };
  }
}

/** The real production service over the fake index. */
function searchService(index: FakeIndex, floor = 0.3): CandidateSearchService {
  const candidates = {
    findByIds: (ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id }) as Candidate)),
  };
  return new CandidateSearchService(
    { findNearest: index.findNearest } as never,
    candidates as never,
    index.asLlm(),
    floor,
  );
}

const personaIds = Array.from(
  { length: 12 },
  (_, i) => `p${String(i + 1).padStart(2, '0')}`,
);
const cand = (personaId: string): string => `c${personaId.slice(1)}`;
const candidateIdByPersonaId = new Map(personaIds.map((p) => [p, cand(p)]));
const personaIdByCandidateId = new Map(personaIds.map((p) => [cand(p), p]));

const CRITERIA: VacancyCriterion[] = [
  { id: 'k1', text: 'TypeScript', importance: 'must' },
  { id: 'k2', text: 'Docker', importance: 'nice' },
];

const dataset = (overrides: Partial<EvalDataset> = {}): EvalDataset => ({
  taxonomy: { description: '', tags: [] },
  personas: personaIds.map((id) => ({ id }) as PersonaSpec),
  vacancies: [
    {
      spec: { id: 'v1', title: 'Spec title', text: 'spec text' } as VacancySpec,
      id: 'V1',
      criteria: CRITERIA,
      criteriaHash: 'h',
    },
  ],
  candidateIdByPersonaId,
  personaIdByCandidateId,
  vacancyIdBySpecId: new Map([['v1', 'V1']]),
  specIdByVacancyId: new Map([['V1', 'v1']]),
  groundTruth: {
    pairs: personaIds.map((personaId, i) => ({
      vacancyId: 'v1',
      personaId,
      score: 0,
      band: i === 0 ? 'strong' : i === 1 ? 'partial' : 'weak',
      requirements: [],
    })),
  },
  queries: [
    {
      id: 'q1',
      query: 'rust services',
      tags: [],
      relevant: ['p01'],
      partiallyRelevant: ['p02'],
    },
    { id: 'q2', query: 'nothing relevant', tags: [], relevant: [] },
  ],
  spotCheck: [],
  ...overrides,
});

const TEXT = { title: 'DB title', requirements: 'DB requirements' };
const WHOLE = `${TEXT.title}\n${TEXT.requirements}`;

describe('evaluateSearch', () => {
  /** c01 .5 (p01, relevant), c02 .32 and .27 (p02, partial), c03 .22, an outsider .31. */
  function index(): FakeIndex {
    return new FakeIndex()
      .on('rust services', [
        hit('c01', 0.5),
        hit('c02', 0.32),
        hit('zz', 0.31),
        hit('c02', 0.27),
        hit('c03', 0.22),
      ])
      .on('nothing relevant', [hit('c05', 0.4)]);
  }

  it('runs the production search per query and maps candidates to personas', async () => {
    const idx = index();
    const result = await evaluateSearch(
      searchService(idx),
      dataset().queries,
      personaIdByCandidateId,
      { productionFloor: 0.3 },
    );

    const [q1] = result.queries;
    // the outsider keeps its candidate id and is counted
    expect(q1.ranked).toEqual(['p01', 'p02', 'zz']);
    expect(q1.returned).toBe(3);
    expect(q1.unmapped).toBe(1);
    expect(q1.relevant).toBe(1);
    expect(q1.partiallyRelevant).toBe(1);
    // gains p01 = 1, p02 = 0.5
    expect(q1.metrics.p5).toBeCloseTo(2 / 5);
    expect(q1.metrics.p10).toBeCloseTo(2 / 10);
    expect(q1.metrics.r10).toBe(1);
    expect(q1.metrics.r20).toBe(1);
    expect(q1.metrics.ndcg10).toBe(1);
    expect(q1.metrics.rr).toBe(1);
  });

  it('embeds each query once, for the production result and the whole sweep', async () => {
    const idx = index();
    await evaluateSearch(searchService(idx), dataset().queries, new Map(), {
      productionFloor: 0.3,
    });
    expect(idx.embedCalls).toEqual([['rust services'], ['nothing relevant']]);
    expect(idx.nearestCalls.map((c) => c.limit)).toEqual([50, 50]);
  });

  it('the sweep row at the production floor equals the production result', async () => {
    const result = await evaluateSearch(
      searchService(index()),
      dataset().queries,
      personaIdByCandidateId,
      { productionFloor: 0.3 },
    );
    const row = result.sweep.find((r) => r.floor === result.productionFloor);
    expect(row).toBeDefined();
    expect(
      row?.queries.map(({ queryId, returned, ranked, metrics }) => ({
        queryId,
        returned,
        ranked,
        metrics,
      })),
    ).toEqual(
      result.queries.map(({ queryId, returned, ranked, metrics }) => ({
        queryId,
        returned,
        ranked,
        metrics,
      })),
    );
    expect(row?.metrics).toEqual(result.metrics);
    expect(row?.returned).toBe(result.returned);
  });

  it('re-ranks the same chunks at each floor', async () => {
    const result = await evaluateSearch(
      searchService(index()),
      dataset().queries,
      personaIdByCandidateId,
      { productionFloor: 0.3 },
    );
    expect(result.sweep.map((r) => r.floor)).toEqual([0.2, 0.25, 0.3, 0.35]);
    const ranked = (floor: number) =>
      result.sweep.find((r) => r.floor === floor)?.queries[0].ranked;
    expect(ranked(0.2)).toEqual(['p01', 'p02', 'zz', 'p03']);
    expect(ranked(0.25)).toEqual(['p01', 'p02', 'zz']);
    expect(ranked(0.3)).toEqual(['p01', 'p02', 'zz']);
    expect(ranked(0.35)).toEqual(['p01']);
    // a lower floor never costs recall here; a higher one loses p02
    const r10 = (floor: number) =>
      result.sweep.find((r) => r.floor === floor)?.queries[0].metrics.r10;
    expect(r10(0.35)).toBeCloseTo(0.5);
    expect(r10(0.2)).toBe(1);
  });

  it('means skip queries where a metric is undefined', async () => {
    const result = await evaluateSearch(
      searchService(index()),
      dataset().queries,
      personaIdByCandidateId,
      { productionFloor: 0.3 },
    );
    // q2 has no relevant persona: its metrics are null, the mean is q1's
    expect(result.queries[1].metrics.p10).toBeNull();
    expect(result.queries[1].returned).toBe(1);
    expect(result.metrics.p10).toBeCloseTo(0.2);
    expect(result.metrics.rr).toBe(1);
    // returned counts every query
    expect(result.returned).toBe(2);
  });

  it('works from any source with the trace shape', async () => {
    const trace: CandidateSearchTrace = { hits: [], results: [] };
    const result = await evaluateSearch(
      { searchWithHits: () => Promise.resolve(trace) },
      dataset().queries,
      personaIdByCandidateId,
      { productionFloor: 0.3 },
    );
    expect(result.queries[0].returned).toBe(0);
    expect(result.queries[0].metrics.p5).toBe(0);
    expect(result.returned).toBe(0);
  });
});

describe('retrieveAll: find matches', () => {
  /** 12 candidates in rank order, c13 under every floor. */
  function matchIndex(snippetOf: (c: string) => string = () => 'snippet') {
    const idx = new FakeIndex();
    const ts = personaIds.map((p, i) =>
      i === 0
        ? hit('c01', 0.8, snippetOf('c01'))
        : hit(cand(p), 0.7 - 0.02 * (i + 1), snippetOf(cand(p))),
    );
    idx.on('TypeScript', [...ts, hit('c13', 0.3)]);
    idx.on('Docker', [hit('c01', 0.7), hit('c02', 0.36), hit('c13', 0.3)]);
    idx.on(WHOLE, [
      hit('c01', 0.9),
      hit('c02', 0.8),
      ...personaIds
        .slice(2)
        .map((p, i) => hit(cand(p), 0.7 - 0.02 * i, snippetOf(cand(p)))),
      hit('c13', 0.29),
    ]);
    return idx;
  }

  const run = (idx: FakeIndex, data = dataset()) => {
    const deps: RetrievalDeps = {
      search: searchService(idx),
      matches: idx.matchDeps,
      searchFloor: 0.3,
      vacancyTexts: new Map([['V1', TEXT]]),
    };
    return retrieveAll(deps, { ...data, queries: [] });
  };

  it('criteria mode: one embed call, whole pool, no exclusion, no cap of 10', async () => {
    const idx = matchIndex();
    const result = await run(idx);

    expect(idx.embedCalls).toEqual([['TypeScript', 'Docker'], [WHOLE]]);
    const criteriaCalls = idx.nearestCalls.filter((c) =>
      ['TypeScript', 'Docker'].includes(c.text),
    );
    expect(criteriaCalls.map((c) => c.limit)).toEqual([30, 30]);
    // findNearest gets (vector, limit) only: no excludeVacancyId
    expect(idx.nearestCalls.every((c) => c.args === 2)).toBe(true);

    const [v] = result.matches.criteria.vacancies;
    // c13 (0.30) is under the 0.35 match floor and drops out
    expect(v.ranked).toEqual(personaIds);
    expect(v.returned).toBe(12);
    expect(v.bands).toEqual({ strong: 1, partial: 1, weak: 10 });
    // gains p01 1, p02 0.5, ranked in that order
    expect(v.metrics.p5).toBeCloseTo(2 / 5);
    expect(v.metrics.r10).toBe(1);
    expect(v.metrics.ndcg10).toBe(1);
    expect(result.matches.criteria.metrics.p10).toBeCloseTo(0.2);
    expect(result.matches.criteria.returned).toBe(12);
    expect(result.settings.matches.maxCandidates).toBe(12);
    expect(result.settings.matches.excludesApplicants).toBe(false);
    expect(result.settings.matches.criteriaFloor).toBe(0.35);
  });

  it('whole_text mode embeds the DB title and requirements, not the spec', async () => {
    const idx = matchIndex();
    const result = await run(idx);

    expect(idx.embedCalls[1]).toEqual([`DB title\nDB requirements`]);
    expect(idx.nearestCalls.find((c) => c.text === WHOLE)?.limit).toBe(50);
    const [v] = result.matches.whole_text.vacancies;
    // c13 (0.29) is under the 0.3 search floor
    expect(v.ranked).toEqual(personaIds);
    expect(v.returned).toBe(12);
    expect(result.settings.matches.wholeTextFloor).toBe(0.3);
  });

  it('G5: weak share of the top 10 and the highest-ranked weak examples', async () => {
    const long = 'x'.repeat(500);
    const result = await run(
      matchIndex((c) => (c === 'c03' ? long : `s ${c}`)),
    );

    const [v] = result.matches.criteria.vacancies;
    // ranks 3..10 are weak: 8 of the top 10
    expect(v.weakInTop10).toBe(8);
    expect(v.weakShareTop10).toBeCloseTo(0.8);
    expect(result.g5.criteria.meanWeakShare).toBeCloseTo(0.8);
    expect(result.g5.criteria.pooledWeakShare).toBeCloseTo(0.8);

    const { worst } = result.g5.criteria;
    expect(worst).toHaveLength(G5_EXAMPLES);
    expect(worst.map((e) => [e.personaId, e.rank])).toEqual([
      ['p03', 3],
      ['p04', 4],
      ['p05', 5],
    ]);
    expect(worst[0].vacancyId).toBe('v1');
    expect(worst[0].snippet).toBe(`${'x'.repeat(200)}...`);
    expect(worst[1].snippet).toBe('s c04');
    // criteria mode: the matched criteria with their similarities
    expect(worst[0].matchedCriteria).toHaveLength(1);
    expect(worst[0].matchedCriteria[0]).toMatchObject({
      criterionId: 'k1',
      criterion: 'TypeScript',
    });
    expect(worst[0].matchedCriteria[0].similarity).toBeCloseTo(0.64);
    // whole_text mode has no criteria
    expect(result.g5.whole_text.worst[0].matchedCriteria).toEqual([]);
    expect(result.g5.whole_text.worst[0].personaId).toBe('p03');
  });

  it('G5 share is over min(10, returned) and null when nothing returned', async () => {
    const idx = new FakeIndex()
      .on('TypeScript', [hit('c01', 0.8), hit('c03', 0.6), hit('c04', 0.5)])
      .on(WHOLE, []);
    const result = await run(idx);

    // c01 strong, c03 and c04 weak: 2 of 3
    expect(result.matches.criteria.vacancies[0].weakShareTop10).toBeCloseTo(
      2 / 3,
    );
    expect(result.matches.whole_text.vacancies[0].returned).toBe(0);
    expect(result.matches.whole_text.vacancies[0].weakShareTop10).toBeNull();
    expect(result.g5.whole_text.meanWeakShare).toBeNull();
    expect(result.g5.whole_text.pooledWeakShare).toBeNull();
    expect(result.g5.whole_text.worst).toEqual([]);
  });

  it('only weak personas inside the top 10 are examples; others are not weak', async () => {
    // p01 strong rank 1, p02 partial rank 2, weak ones start at rank 11
    const idx = new FakeIndex().on(WHOLE, [
      ...personaIds.map((p, i) => hit(cand(p), 0.9 - 0.01 * i)),
    ]);
    const data = dataset({
      groundTruth: {
        pairs: personaIds.map((personaId, i) => ({
          vacancyId: 'v1',
          personaId,
          score: 0,
          band: i < 10 ? 'partial' : 'weak',
          requirements: [],
        })),
      },
    });
    const result = await run(idx, data);
    expect(result.matches.whole_text.vacancies[0].weakInTop10).toBe(0);
    expect(result.g5.whole_text.worst).toEqual([]);
  });

  it('maps unlabelled and unknown candidates to irrelevant, not weak', async () => {
    const idx = new FakeIndex().on(WHOLE, [hit('zz', 0.9), hit('c01', 0.8)]);
    const result = await run(idx);
    const [v] = result.matches.whole_text.vacancies;
    expect(v.ranked).toEqual(['zz', 'p01']);
    expect(v.weakInTop10).toBe(0);
    expect(v.metrics.p5).toBeCloseTo(1 / 5);
  });

  it('refuses a vacancy without stored text', async () => {
    const idx = matchIndex();
    await expect(
      retrieveAll(
        {
          search: searchService(idx),
          matches: idx.matchDeps,
          searchFloor: 0.3,
          vacancyTexts: new Map(),
        },
        dataset({ queries: [] }),
      ),
    ).rejects.toThrow('No stored text for vacancy v1');
  });

  it('honours overridden floors and reports them', async () => {
    const idx = matchIndex();
    const result = await retrieveAll(
      {
        search: searchService(idx, 0),
        matches: idx.matchDeps,
        searchFloor: 0,
        vacancyTexts: new Map([['V1', TEXT]]),
      },
      dataset({ queries: [] }),
      { matchFloors: { criteria: 0.55, wholeText: 0.85 }, sweepFloors: [0.1] },
    );
    expect(result.matches.criteria.vacancies[0].returned).toBe(7);
    expect(result.matches.whole_text.vacancies[0].ranked).toEqual(['p01']);
    expect(result.settings.search.sweepFloors).toEqual([0.1]);
    expect(result.settings.matches.criteriaFloor).toBe(0.55);
    expect(result.search.sweep).toHaveLength(1);
  });
});
