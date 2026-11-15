import { join } from 'node:path';
import { checkCv } from '../drift.js';
import { assembleCv } from '../assemble.js';
import {
  Budget,
  estimateUsd,
  executeJobs,
  GenerationRun,
  liveLlm,
  parsePersonaFlags,
  planTargets,
  printDryRun,
  promptTokens,
  structuredAttempt,
  type EstimateItem,
  type Job,
  type StageDeps,
} from '../generation.js';
import { exists, loadPersonas, loadTaxonomy, writeJson } from '../io.js';
import {
  buildCvPrompt,
  CV_SCHEMA_NAME,
  cvOutputSchema,
} from '../prompts/cv-prompt.js';
import type { CvContent } from '../cv-content.js';
import type { PersonaSpec } from '../types.js';

export const CVS_USAGE = `synth cvs [--only <ids>] [--force <ids|all>] [--concurrency N] [--max-usd N] [--dry-run]
  Writes cvs/<personaId>.json (LLM prose from the persona spec, drift-checked).
  Skips existing files. --only p001,p002 limits the run; --force p001,p002 or
  --force all regenerates. Default --concurrency 4, --max-usd 2.`;

/** Output tokens of one CV call, from the spec (Ukrainian costs more tokens). */
export function cvOutputTokens(p: PersonaSpec): number {
  const base = 500 + p.roles.length * 220 + p.projects.length * 90;
  return Math.round(p.language === 'uk' ? base * 1.8 : base);
}

export async function runCvs(
  argv: string[],
  dir: string,
  deps: StageDeps = {},
): Promise<void> {
  const flags = parsePersonaFlags(argv);
  const taxonomy = await loadTaxonomy(dir);
  const { personas } = await loadPersonas(dir);
  const byId = new Map(personas.map((p) => [p.id, p]));
  const cvPath = (id: string): string => join(dir, 'cvs', `${id}.json`);

  const plan = await planTargets(
    personas.map((p) => p.id),
    (id) => exists(cvPath(id)),
    flags,
  );
  const estimateOf = (p: PersonaSpec): EstimateItem => ({
    id: p.id,
    inputTokens: promptTokens(buildCvPrompt(p, taxonomy)),
    outputTokens: cvOutputTokens(p),
  });

  if (flags.dryRun) {
    printDryRun(
      'cvs',
      plan.todo.map((id) => estimateOf(byId.get(id)!)),
      plan.skipped.length,
      flags.maxUsd,
    );
    return;
  }
  if (plan.todo.length === 0) {
    console.log(`cvs: nothing to do (${plan.skipped.length} already exist).`);
    return;
  }

  const run = new GenerationRun(
    deps.llm ?? liveLlm(),
    new Budget(flags.maxUsd),
  );
  const jobs: Job<CvContent>[] = plan.todo.map((id) => {
    const persona = byId.get(id)!;
    const est = estimateOf(persona);
    return {
      id,
      attempt: (feedback) =>
        structuredAttempt(
          run,
          {
            prompt: buildCvPrompt(persona, taxonomy, feedback),
            schema: cvOutputSchema,
            schemaName: CV_SCHEMA_NAME,
            estimateUsd: estimateUsd(est.inputTokens, est.outputTokens),
          },
          (out) => {
            const { cv, problems } = assembleCv(persona, out);
            if (!cv) return { ok: false, problems };
            const report = checkCv(cv, persona, taxonomy);
            return report.errors.length > 0
              ? { ok: false, problems: report.errors }
              : { ok: true, value: cv, warnings: report.warnings };
          },
        ),
      write: (cv) => writeJson(cvPath(id), cv),
    };
  });
  await executeJobs('cvs', dir, run, flags, jobs);
}
