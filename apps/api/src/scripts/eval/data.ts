/** Loading the synthetic set (`data/synthetic/`) the eval measures against. */
import { join } from 'node:path';
import { loadPersonas, loadVacancies } from '../seed/inputs.js';
import { loadQueries, loadTaxonomy, readJson, SYNTH_DIR } from '../synth/io.js';
import type { LabelEntry } from '../synth/spot-check.js';
import type {
  GroundTruth,
  PersonaSpec,
  SearchQuery,
  Taxonomy,
  VacancySpec,
} from '../synth/types.js';

/** The files of `data/synthetic/` the eval reads, as one value. */
export interface SyntheticSet {
  personas: PersonaSpec[];
  vacancies: VacancySpec[];
  groundTruth: GroundTruth;
  queries: SearchQuery[];
  taxonomy: Taxonomy;
  /** Dude's blind labels (`spot-check/labels.json`). */
  spotCheckLabels: LabelEntry[];
}

/**
 * Reads the set the seed was built from: the same personas and vacancies
 * files as `db:seed` (vacancies.json, never the draft), plus the rule labels,
 * the search queries, the taxonomy and the spot-check labels.
 */
export async function loadSyntheticSet(
  dir: string = SYNTH_DIR,
): Promise<SyntheticSet> {
  const [personas, vacancies, groundTruth, queries, taxonomy, spotCheckLabels] =
    await Promise.all([
      loadPersonas(dir),
      loadVacancies(dir, null),
      readJson<GroundTruth>(join(dir, 'ground-truth.json')),
      loadQueries(dir),
      loadTaxonomy(dir),
      readJson<LabelEntry[]>(join(dir, 'spot-check', 'labels.json')),
    ]);
  return {
    personas,
    vacancies,
    groundTruth,
    queries,
    taxonomy,
    spotCheckLabels,
  };
}
