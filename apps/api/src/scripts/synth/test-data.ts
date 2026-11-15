/**
 * Loads the committed taxonomy and the hand-written vacancy drafts for specs.
 * Test helper, not shipped logic.
 */
import { loadTaxonomy, loadVacancies, SYNTH_DIR } from './io.js';
import type { Taxonomy, VacancySpec } from './types.js';

let cache:
  Promise<{ taxonomy: Taxonomy; vacancies: VacancySpec[] }> | undefined;

export function loadDraftData(): Promise<{
  taxonomy: Taxonomy;
  vacancies: VacancySpec[];
}> {
  cache ??= Promise.all([
    loadTaxonomy(SYNTH_DIR),
    // always the draft: specs must not depend on generated prose
    loadVacancies(SYNTH_DIR, { draft: true }),
  ]).then(([taxonomy, vacancies]) => ({ taxonomy, vacancies }));
  return cache;
}
