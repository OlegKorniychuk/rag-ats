/**
 * Rebuilds `<label>.json` and `<label>.md` from whatever exists in the label
 * directory (retrieval.json, scores.jsonl, run-log.json, filled-in reviews).
 * Needs the synthetic set (files) but no database and no LLM.
 */
import { readScoreCache } from './cache.js';
import { buildAggregate, type BaselineAggregate } from './aggregate.js';
import type { SyntheticSet } from './data.js';
import {
  baselinePaths,
  readRetrieval,
  readRunLog,
  readText,
  writeFormatted,
  writeJson,
  type RunLogEntry,
} from './layout.js';
import { renderReportRaw } from './report.js';
import {
  buildEvalSample,
  type EvalSample,
  type SpotCheckLabel,
} from './sample.js';
import { SCORING_MODES } from './score-record.js';
import {
  parseReview,
  ReviewError,
  reviewAggregateOf,
  type ReviewAggregate,
} from './review.js';
import { BANDS } from '../synth/spot-check.js';
import type { Band } from '../synth/types.js';

export interface SampleParams {
  seed: number;
  weak: number;
  noise: number;
}

/** The sample of a run: all strong and partial pairs, `weak` random weak ones, the spot-check pairs. */
export function sampleFromSet(
  set: Pick<SyntheticSet, 'groundTruth' | 'spotCheckLabels'>,
  params: Pick<SampleParams, 'seed' | 'weak'>,
): EvalSample {
  const labels: SpotCheckLabel[] = set.spotCheckLabels.map((l) => ({
    vacancyId: l.vacancyId,
    personaId: l.personaId,
    band: BANDS.includes(l.band as Band) ? (l.band as Band) : null,
  }));
  return buildEvalSample(set.groundTruth.pairs, labels, {
    seed: params.seed,
    weak: params.weak,
  });
}

/**
 * The sample parameters the cached scores were made with: the newest logged
 * invocation that scored, else `fallback`. A report rebuilt without scoring
 * must join the cache to the same sample it was made from.
 */
export function sampleParamsOfRuns(
  runs: readonly RunLogEntry[],
  fallback: SampleParams,
): SampleParams {
  const last = [...runs].reverse().find((r) => r.scoring !== null);
  return last
    ? { seed: last.seed, weak: last.weak, noise: last.noise }
    : fallback;
}

export interface RebuildOptions {
  /** Absolute baseline directory (`<repo>/docs/eval/baseline`). */
  baselineDir: string;
  label: string;
  set: SyntheticSet;
  /** Used when this invocation scored; otherwise the run log decides. */
  params: SampleParams;
  /** True when this invocation ran scoring (then `params` are authoritative). */
  scored: boolean;
  now?: () => Date;
}

export interface RebuildResult {
  aggregate: BaselineAggregate;
  jsonPath: string;
  mdPath: string;
  warnings: string[];
}

/** Reads the review files that exist; an unreadable or half-edited one is skipped with a warning. */
async function readReviews(
  paths: ReturnType<typeof baselinePaths>,
  warnings: string[],
): Promise<ReviewAggregate[]> {
  const out: ReviewAggregate[] = [];
  for (const mode of SCORING_MODES) {
    const text = await readText(paths.review(mode));
    if (text === null) continue;
    try {
      out.push(reviewAggregateOf(mode, parseReview(text)));
    } catch (error) {
      if (!(error instanceof ReviewError)) throw error;
      warnings.push(`${paths.review(mode)} skipped: ${error.message}`);
    }
  }
  return out;
}

export async function rebuildBaseline(
  options: RebuildOptions,
): Promise<RebuildResult> {
  const paths = baselinePaths(options.baselineDir, options.label);
  const warnings: string[] = [];
  const runs = await readRunLog(paths);
  const params = options.scored
    ? options.params
    : sampleParamsOfRuns(runs, options.params);
  const cache = await readScoreCache(paths.scores);
  if (cache.corruptLines > 0) {
    warnings.push(
      `${cache.corruptLines} unreadable line(s) in ${paths.scores} were skipped`,
    );
  }
  const aggregate = buildAggregate({
    label: options.label,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sample: sampleFromSet(options.set, params),
    sampleParams: { weak: params.weak, noise: params.noise },
    dataset: options.set,
    records: [...cache.byKey.values()],
    retrieval: await readRetrieval(paths),
    runs,
    reviews: await readReviews(paths, warnings),
  });
  await writeJson(paths.aggregateJson, aggregate);
  await writeFormatted(
    paths.aggregateMd,
    renderReportRaw(aggregate),
    'markdown',
  );
  return {
    aggregate,
    jsonPath: paths.aggregateJson,
    mdPath: paths.aggregateMd,
    warnings,
  };
}
