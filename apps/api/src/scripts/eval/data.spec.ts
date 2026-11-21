import 'reflect-metadata';
import { loadSyntheticSet } from './data.js';
import {
  buildEvalDataset,
  findPreflightProblems,
  personaEmailKey,
  type DbState,
} from './preflight.js';
import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';

describe('loadSyntheticSet (the committed data/synthetic files)', () => {
  it('loads a set that is consistent with itself', async () => {
    const set = await loadSyntheticSet();
    expect(set.personas).toHaveLength(100);
    expect(set.vacancies).toHaveLength(10);
    expect(set.groundTruth.pairs).toHaveLength(1000);
    expect(set.queries).toHaveLength(20);
    expect(set.spotCheckLabels).toHaveLength(30);
    expect(set.taxonomy.tags.length).toBeGreaterThan(0);

    // A database that holds exactly what the set describes passes the
    // preflight, so every id in the ground truth, queries and labels resolves
    // and every spot-check pair carries a band.
    const db: DbState = {
      recruiterEmail: 'seed@example.com',
      recruiterFound: true,
      candidatesByEmail: new Map(
        set.personas.map((p) => [
          personaEmailKey(p),
          {
            candidateId: `cand-${p.id}`,
            parseStatus: 'parsed' as const,
            parsedCvDocumentId: `cv-${p.id}`,
            latestCvDocumentId: `cv-${p.id}`,
            embeddedCvDocumentId: `cv-${p.id}`,
          },
        ]),
      ),
      vacanciesByTitle: new Map(
        set.vacancies.map((v) => [
          v.title,
          [
            {
              id: `db-${v.id}`,
              title: v.title,
              requirements: v.text,
              criteria: [{ id: 'c1', text: 'x', importance: 'must' as const }],
              criteriaHash: vacancyCriteriaHash(v.title, v.text),
            },
          ],
        ]),
      ),
    };
    expect(findPreflightProblems(set, db)).toEqual([]);
    expect(buildEvalDataset(set, db).spotCheck).toHaveLength(30);
  });
});
