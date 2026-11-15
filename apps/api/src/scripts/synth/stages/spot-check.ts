import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseNumber, UsageError } from '../../shared/cli.js';
import type { CvContent } from '../cv-content.js';
import {
  exists,
  loadPersonas,
  loadVacancies,
  readJson,
  writeJson,
} from '../io.js';
import {
  computeAgreement,
  emptyLabels,
  hasLabels,
  missingLabels,
  renderAgreementMarkdown,
  renderSampleMarkdown,
  sampleStratified,
  toSampleFile,
  type GithubFixtureView,
  type LabelEntry,
  type SampleEntry,
} from '../spot-check.js';
import type { GroundTruth, PersonaSpec } from '../types.js';

export const SPOT_CHECK_USAGE = `synth spot-check --sample 30 [--seed N] [--force]
synth spot-check --score
  --sample writes spot-check/sample.md (blind pairs to read), labels.json (to fill
  in: strong / partial / weak per pair) and sample.json. Needs ground-truth.json
  and cvs/<id>.json. Refuses to overwrite labels that are already filled in
  unless --force.
  --score compares labels.json with the rule's bands: exact agreement, Cohen's
  kappa (plain and quadratic), confusion matrix, disagreements. Writes
  agreement.md and agreement.json. Exit code 2 while labels are missing.`;

async function runSample(
  dir: string,
  size: number,
  seed: number,
  force: boolean,
): Promise<void> {
  const out = join(dir, 'spot-check');
  const labelsPath = join(out, 'labels.json');
  if (!force && (await exists(labelsPath))) {
    const existing = await readJson<LabelEntry[]>(labelsPath);
    if (hasLabels(existing)) {
      throw new UsageError(
        `${labelsPath} already holds labels. Pass --force to replace them with a new sample.`,
      );
    }
  }

  const truth = await readJson<GroundTruth>(join(dir, 'ground-truth.json'));
  const vacancies = await loadVacancies(dir);
  const { personas } = await loadPersonas(dir);
  const personaById = new Map<string, PersonaSpec>(
    personas.map((p) => [p.id, p]),
  );

  // Only pairs whose CV exists can be read by a human.
  const withCv = new Set<string>();
  for (const p of personas) {
    if (await exists(join(dir, 'cvs', `${p.id}.json`))) withCv.add(p.id);
  }
  const candidates = truth.pairs.filter((p) => withCv.has(p.personaId));
  if (candidates.length === 0) {
    throw new UsageError(
      `No ground-truth pair has a cvs/<id>.json in ${dir}. Run "synth cvs" first.`,
    );
  }

  const sample = sampleStratified(candidates, size, seed);
  if (sample.length < size) {
    console.warn(`Warning: only ${sample.length} of ${size} pairs available`);
  }
  const sampleFile = toSampleFile(sample, seed);

  const entries: SampleEntry[] = [];
  for (const p of sampleFile.pairs) {
    const vacancy = vacancies.find((v) => v.id === p.vacancyId);
    if (!vacancy) throw new Error(`Unknown vacancy ${p.vacancyId}`);
    const cv = await readJson<CvContent>(
      join(dir, 'cvs', `${p.personaId}.json`),
    );
    const username = personaById.get(p.personaId)?.github?.username;
    const githubPath = username
      ? join(dir, 'github', `${username}.json`)
      : null;
    entries.push({
      pair: p.pair,
      vacancy,
      cv,
      pdfPath: `../pdf/${p.personaId}.pdf`,
      github:
        githubPath && (await exists(githubPath))
          ? await readJson<GithubFixtureView>(githubPath)
          : null,
    });
  }

  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'sample.md'), renderSampleMarkdown(entries, seed));
  await writeJson(join(out, 'sample.json'), sampleFile);
  await writeJson(labelsPath, emptyLabels(sampleFile));
  console.log(
    `Wrote ${sample.length} pairs to ${out}\n` +
      `Read sample.md, then fill "band" (strong | partial | weak) for every pair in labels.json and run "synth spot-check --score".`,
  );
}

async function runScore(dir: string): Promise<void> {
  const out = join(dir, 'spot-check');
  const labelsPath = join(out, 'labels.json');
  if (!(await exists(labelsPath))) {
    throw new UsageError(
      `${labelsPath} not found. Run "synth spot-check --sample 30" first.`,
    );
  }
  const labels = await readJson<LabelEntry[]>(labelsPath);
  const missing = missingLabels(labels);
  if (missing.length > 0) {
    throw new UsageError(
      `labels.json is not complete: pair(s) ${missing.join(', ')} need a band of strong, partial or weak.`,
    );
  }

  const truth = await readJson<GroundTruth>(join(dir, 'ground-truth.json'));
  const vacancies = await loadVacancies(dir);
  const agreement = computeAgreement(labels, truth.pairs, vacancies);
  await writeFile(
    join(out, 'agreement.md'),
    renderAgreementMarkdown(agreement),
  );
  await writeJson(join(out, 'agreement.json'), agreement);

  console.log(
    `${agreement.pairs} pairs: exact agreement ${(100 * agreement.exactAgreement).toFixed(1)}%, ` +
      `kappa ${agreement.kappa.toFixed(3)}, quadratic kappa ${agreement.quadraticKappa.toFixed(3)}, ` +
      `${agreement.disagreements.length} disagreement(s). See ${join(out, 'agreement.md')}`,
  );
}

/** `synth spot-check`: blind sample for Dude, then the agreement score. */
export async function runSpotCheck(argv: string[], dir: string): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      sample: { type: 'string' },
      seed: { type: 'string' },
      score: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.score === (values.sample !== undefined)) {
    throw new UsageError('Pass exactly one of --sample <n> or --score');
  }
  if (values.score) return runScore(dir);
  await runSample(
    dir,
    parseNumber('sample', values.sample, 30, true),
    parseNumber('seed', values.seed, 1, true),
    values.force,
  );
}
