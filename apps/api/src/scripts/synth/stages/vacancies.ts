import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from '../../shared/cli.js';
import { checkVacancy } from '../drift.js';
import {
  Budget,
  COMMON_OPTIONS,
  commonFlags,
  estimateUsd,
  executeJobs,
  GenerationRun,
  liveLlm,
  printDryRun,
  promptTokens,
  structuredAttempt,
  type EstimateItem,
  type Job,
  type StageDeps,
} from '../generation.js';
import { exists, loadTaxonomy, readJson, writeJson } from '../io.js';
import {
  buildVacancyPrompt,
  VACANCY_SCHEMA_NAME,
  vacancySchema,
} from '../prompts/vacancy-prompt.js';
import type { VacancySpec } from '../types.js';
import { renderVacancyText, validateVacancies } from '../vacancies.js';

/**
 * The rendered text already has "Requirements" / "Nice to have" headings, so a
 * leading label the model repeats in a bullet ("Nice to have: Docker") goes.
 */
export function stripSectionLabel(text: string): string {
  const stripped = text
    .trim()
    .replace(
      /^(nice to have|must have|required|requirement|bonus|plus)\s*[:\u2013\u2014-]\s*/i,
      '',
    );
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export const VACANCIES_USAGE = `synth vacancies [--force] [--concurrency N] [--max-usd N] [--dry-run]
  Rewrites the prose of vacancies.draft.json (title, intro, requirement text)
  into vacancies.json; ids, kinds, tags and minYears stay as drafted. Skips when
  vacancies.json exists unless --force. All-or-nothing: no partial file.`;

/** Output tokens of one vacancy call, from its requirement count. */
const vacancyOutputTokens = (v: VacancySpec): number =>
  150 + v.requirements.length * 55;

export async function runVacancies(
  argv: string[],
  dir: string,
  deps: StageDeps = {},
): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { force: { type: 'boolean', default: false }, ...COMMON_OPTIONS },
    strict: true,
  });
  const flags = commonFlags(values);
  const out = join(dir, 'vacancies.json');
  if ((await exists(out)) && !values.force) {
    console.log(
      `vacancies: ${out} already exists, skipping (--force to redo).`,
    );
    return;
  }

  const taxonomy = await loadTaxonomy(dir);
  const drafts = await readJson<VacancySpec[]>(
    join(dir, 'vacancies.draft.json'),
  );
  const problems = validateVacancies(drafts, taxonomy);
  if (problems.length > 0) {
    throw new UsageError(
      `Invalid draft vacancies:\n  ${problems.join('\n  ')}`,
    );
  }
  const estimateOf = (v: VacancySpec): EstimateItem => ({
    id: v.id,
    inputTokens: promptTokens(buildVacancyPrompt(v, taxonomy)),
    outputTokens: vacancyOutputTokens(v),
  });

  if (flags.dryRun) {
    printDryRun('vacancies', drafts.map(estimateOf), 0, flags.maxUsd);
    return;
  }

  const run = new GenerationRun(
    deps.llm ?? liveLlm(),
    new Budget(flags.maxUsd),
  );
  const done = new Map<string, VacancySpec>();
  const jobs: Job<VacancySpec>[] = drafts.map((draft) => {
    const est = estimateOf(draft);
    return {
      id: draft.id,
      attempt: (feedback) =>
        structuredAttempt(
          run,
          {
            prompt: buildVacancyPrompt(draft, taxonomy, feedback),
            schema: vacancySchema(draft),
            schemaName: VACANCY_SCHEMA_NAME,
            estimateUsd: estimateUsd(est.inputTokens, est.outputTokens),
          },
          (rewrite) => {
            const report = checkVacancy(draft, rewrite, taxonomy);
            if (report.errors.length > 0) {
              return { ok: false, problems: report.errors };
            }
            const text = new Map(
              rewrite.requirements.map((r) => [
                r.id,
                stripSectionLabel(r.text),
              ]),
            );
            const final: VacancySpec = {
              ...draft,
              title: rewrite.title.trim(),
              intro: rewrite.intro.trim(),
              requirements: draft.requirements.map((r) => ({
                ...r,
                text: text.get(r.id)!,
              })),
              text: '',
            };
            final.text = renderVacancyText(final);
            return { ok: true, value: final, warnings: report.warnings };
          },
        ),
      write: async (v) => {
        done.set(v.id, v);
      },
    };
  });
  const outcomes = await executeJobs('vacancies', dir, run, flags, jobs);

  if (done.size < drafts.length || outcomes.some((o) => o.status !== 'ok')) {
    console.log('vacancies: incomplete, vacancies.json not written.');
    return;
  }
  await writeJson(
    out,
    drafts.map((d) => done.get(d.id)),
  );
  console.log(`Wrote ${out}`);
}
