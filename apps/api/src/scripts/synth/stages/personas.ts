import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { parseNumber, UsageError } from '../../shared/cli.js';
import { exists, loadTaxonomy, loadVacancies, writeJson } from '../io.js';
import { generatePersonas } from '../personas.js';
import { validateVacancies } from '../vacancies.js';

export const PERSONAS_USAGE = `synth personas [--seed N] [--force]
  Generates data/synthetic/personas.json (100 persona specs, no LLM).`;

/** `synth personas`: refuses to overwrite personas.json without --force. */
export async function runPersonas(argv: string[], dir: string): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      seed: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const seed = parseNumber('seed', values.seed, 1, true);
  const out = join(dir, 'personas.json');
  if ((await exists(out)) && !values.force) {
    throw new UsageError(
      `${out} already exists. Pass --force to regenerate it (CVs and GitHub fixtures built from it become stale).`,
    );
  }

  const taxonomy = await loadTaxonomy(dir);
  const vacancies = await loadVacancies(dir);
  const problems = validateVacancies(vacancies, taxonomy);
  if (problems.length > 0) {
    throw new UsageError(`Invalid vacancies:\n  ${problems.join('\n  ')}`);
  }

  const result = generatePersonas(taxonomy, vacancies, seed);
  await writeJson(out, { seed: result.seed, personas: result.personas });

  const count = (pred: (p: (typeof result.personas)[number]) => boolean) =>
    result.personas.filter(pred).length;
  console.log(
    `Wrote ${out}\n` +
      `${result.personas.length} personas (seed ${result.seed}, ${result.attempts} attempt(s)): ` +
      `${count((p) => p.kind === 'targeted')} targeted, ` +
      `${count((p) => p.kind === 'off_target')} off-target, ` +
      `${count((p) => p.github !== null)} with GitHub, ` +
      `${count((p) => p.skills.some((s) => s.evidence === 'github_only'))} with github_only skills, ` +
      `${count((p) => p.language === 'uk')} uk.`,
  );
}
