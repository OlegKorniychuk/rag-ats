import { loadDraftData } from './test-data.js';
import { loadQueries, SYNTH_DIR } from './io.js';
import { validateQueries } from './queries.js';

describe('taxonomy.json', () => {
  it('has unique tags, aliases for skills and none for experience tags', async () => {
    const { taxonomy } = await loadDraftData();
    const tags = taxonomy.tags.map((t) => t.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.length).toBeGreaterThanOrEqual(80);
    for (const t of taxonomy.tags) {
      if (t.kind === 'experience') {
        expect(t.tag).toMatch(/^exp-/);
        expect(t.aliases).toEqual([]);
      } else {
        expect(t.aliases.length).toBeGreaterThan(0);
      }
    }
    expect(taxonomy.description).toContain('exp-backend');
  });

  it('flags short or common-word aliases as ambiguous', async () => {
    const { taxonomy } = await loadDraftData();
    const ambiguous = new Set(
      taxonomy.tags.filter((t) => t.ambiguous).map((t) => t.tag),
    );
    for (const tag of [
      'go',
      'r',
      'c',
      'rust',
      'swift',
      'spring-boot',
      'csharp',
    ]) {
      expect(ambiguous.has(tag)).toBe(true);
    }
    // Every alias of 1-2 characters must live on an ambiguous tag.
    for (const t of taxonomy.tags) {
      if (t.aliases.some((a) => a.length <= 2) && !t.ambiguous) {
        throw new Error(`${t.tag} has a short alias but is not ambiguous`);
      }
    }
  });
});

describe('queries.json', () => {
  it('has ~20 queries over known tags', async () => {
    const { taxonomy } = await loadDraftData();
    const queries = await loadQueries(SYNTH_DIR);
    expect(queries.length).toBeGreaterThanOrEqual(18);
    expect(validateQueries(queries, taxonomy)).toEqual([]);
  });
});
