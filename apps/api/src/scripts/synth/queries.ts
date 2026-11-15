import { searchRelevance } from './ground-truth.js';
import type { PersonaSpec, SearchQuery, Taxonomy } from './types.js';

/** Fills `relevant` / `partiallyRelevant` from the personas' skills. */
export function labelQueries(
  queries: SearchQuery[],
  personas: Array<Pick<PersonaSpec, 'id' | 'skills'>>,
): SearchQuery[] {
  return queries.map((q) => ({
    id: q.id,
    query: q.query,
    tags: q.tags,
    ...searchRelevance(personas, q),
  }));
}

export function validateQueries(
  queries: SearchQuery[],
  taxonomy: Taxonomy,
): string[] {
  const known = new Set(taxonomy.tags.map((t) => t.tag));
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const q of queries) {
    if (ids.has(q.id)) problems.push(`duplicate query id ${q.id}`);
    ids.add(q.id);
    if (q.tags.length === 0) problems.push(`${q.id}: no tags`);
    for (const tag of q.tags) {
      if (!known.has(tag)) problems.push(`${q.id}: unknown tag "${tag}"`);
    }
  }
  return problems;
}
