import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { UsageError } from '../../shared/cli.js';
import {
  bandDistribution,
  checkDistribution,
  computeGroundTruth,
} from '../ground-truth.js';
import {
  loadPersonas,
  loadQueries,
  loadTaxonomy,
  loadVacancies,
  writeGroundTruth,
  writeJson,
} from '../io.js';
import { labelQueries, validateQueries } from '../queries.js';
import { formatBandTable, formatQueryTable } from '../report.js';
import { validateVacancies } from '../vacancies.js';

export const LABELS_USAGE = `synth labels
  Writes ground-truth.json (every persona x vacancy pair) and fills the
  relevant / partiallyRelevant ids of queries.json. No LLM calls.`;

/** `synth labels`: apply the ground-truth rule to the current specs. */
export async function runLabels(argv: string[], dir: string): Promise<void> {
  parseArgs({ args: argv, options: {}, strict: true });

  const taxonomy = await loadTaxonomy(dir);
  const vacancies = await loadVacancies(dir);
  const { personas } = await loadPersonas(dir);
  const queries = await loadQueries(dir);
  const problems = [
    ...validateVacancies(vacancies, taxonomy),
    ...validateQueries(queries, taxonomy),
  ];
  if (problems.length > 0) {
    throw new UsageError(`Invalid input:\n  ${problems.join('\n  ')}`);
  }

  const gt = computeGroundTruth(personas, vacancies);
  const vacancyIds = vacancies.map((v) => v.id);
  const labelled = labelQueries(queries, personas);
  await writeGroundTruth(dir, gt);
  await writeJson(join(dir, 'queries.json'), labelled);

  console.log(
    `Wrote ground-truth.json (${gt.pairs.length} pairs) and queries.json (${labelled.length} queries)\n`,
  );
  console.log(formatBandTable(bandDistribution(gt, vacancyIds)));
  console.log(`\n${formatQueryTable(labelled)}`);

  const guard = checkDistribution(gt, vacancyIds);
  if (guard.length > 0) {
    throw new UsageError(
      `Distribution guard failed (regenerate personas):\n  ${guard.join('\n  ')}`,
    );
  }
  const empty = labelled.filter((q) => q.relevant?.length === 0);
  if (empty.length > 0) {
    console.warn(
      `\nWarning: no relevant candidates for ${empty.map((q) => q.id).join(', ')}`,
    );
  }
}
