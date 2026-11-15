import { join } from 'node:path';
import type { GithubFixture } from '../../../github/fixture-github-client.js';
import { assembleFixture } from '../assemble.js';
import { checkGithub } from '../drift.js';
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
  buildGithubPrompt,
  GITHUB_SCHEMA_NAME,
  githubOutputSchema,
  languageLabels,
} from '../prompts/github-prompt.js';
import type { PersonaSpec } from '../types.js';

export const GITHUB_USAGE = `synth github [--only <ids>] [--force <ids|all>] [--concurrency N] [--max-usd N] [--dry-run]
  Writes github/<username>.json (a GitHub API fixture) for personas with a
  profile. Ids are persona ids. Skips existing files; same flags as cvs.`;

/** Output tokens of one profile call: bio plus about 5.5 repos with READMEs. */
export const GITHUB_OUTPUT_TOKENS = 2200;

export async function runGithub(
  argv: string[],
  dir: string,
  deps: StageDeps = {},
): Promise<void> {
  const flags = parsePersonaFlags(argv);
  const taxonomy = await loadTaxonomy(dir);
  const { personas } = await loadPersonas(dir);
  const withGithub = personas.filter((p) => p.github !== null);
  const byId = new Map(withGithub.map((p) => [p.id, p]));
  const fixturePath = (p: PersonaSpec): string =>
    join(dir, 'github', `${p.github!.username}.json`);

  const plan = await planTargets(
    withGithub.map((p) => p.id),
    (id) => exists(fixturePath(byId.get(id)!)),
    flags,
  );
  const estimateOf = (p: PersonaSpec): EstimateItem => ({
    id: p.id,
    inputTokens: promptTokens(buildGithubPrompt(p, taxonomy)),
    outputTokens: GITHUB_OUTPUT_TOKENS,
  });

  if (flags.dryRun) {
    printDryRun(
      'github',
      plan.todo.map((id) => estimateOf(byId.get(id)!)),
      plan.skipped.length,
      flags.maxUsd,
    );
    return;
  }
  if (plan.todo.length === 0) {
    console.log(
      `github: nothing to do (${plan.skipped.length} already exist).`,
    );
    return;
  }

  const run = new GenerationRun(
    deps.llm ?? liveLlm(),
    new Budget(flags.maxUsd),
  );
  const jobs: Job<GithubFixture>[] = plan.todo.map((id) => {
    const persona = byId.get(id)!;
    const est = estimateOf(persona);
    const schema = githubOutputSchema(languageLabels(persona, taxonomy));
    return {
      id,
      attempt: (feedback) =>
        structuredAttempt(
          run,
          {
            prompt: buildGithubPrompt(persona, taxonomy, feedback),
            schema,
            schemaName: GITHUB_SCHEMA_NAME,
            estimateUsd: estimateUsd(est.inputTokens, est.outputTokens),
          },
          (out) => {
            const fixture = assembleFixture(persona, out);
            const report = checkGithub(fixture, persona, taxonomy);
            return report.errors.length > 0
              ? { ok: false, problems: report.errors }
              : { ok: true, value: fixture, warnings: report.warnings };
          },
        ),
      write: (fixture) => writeJson(fixturePath(persona), fixture),
    };
  });
  await executeJobs('github', dir, run, flags, jobs);
}
