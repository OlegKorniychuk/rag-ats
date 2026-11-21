/**
 * Aggregation of the eval: joins the scoring cache to the sample and computes
 * every number of the report (agreement, bootstrap CIs, Dude's labels, noise,
 * grounding, cost, G4, slices), plus the retrieval result as it is. Pure: no
 * I/O, no clock (the caller passes `generatedAt`).
 */
import { PRICING_CAVEAT } from '../parse-eval/cost.js';
import { bandOf } from '../synth/ground-truth.js';
import type { ConfusionMatrix } from '../synth/spot-check.js';
import type { Band, PersonaSpec } from '../synth/types.js';
import { g4ForRecord, type G4Dataset } from './g4-pair.js';
import { groundingBucketCounts, type GroundingBucket } from './grounding.js';
import type { RunLogEntry } from './layout.js';
import {
  bandKappas,
  bootstrapCi,
  bootstrapDifference,
  kappaOf,
  mae,
  maeOf,
  mean,
  meanSignedError,
  perBandMae,
  quadraticKappaOf,
  scorerBandPairs,
  spearman,
  spearmanOf,
  weightedBandAgreement,
  weightedMae,
  type AgreementRow,
  type BandKappas,
  type BandPair,
  type ConfidenceInterval,
  type Maybe,
} from './metrics.js';
import type { RetrievalResult } from './retrieval.js';
import type { ReviewAggregate } from './review.js';
import { pairKey, type EvalSample, type SampledPair } from './sample.js';
import {
  SCORING_MODES,
  type FailureKind,
  type ScoreJobRecord,
  type ScoreOkRecord,
  type ScoringMode,
} from './score-record.js';

// --- Shapes ------------------------------------------------------------------

export interface SampleInfo {
  seed: number;
  weak: number;
  noise: number;
  population: Record<Band, number>;
  sampled: Record<Band, number>;
  /** Pairs in the sample. */
  pairs: number;
  /** Sampled pairs that carry one of Dude's labels. */
  spotCheckPairs: number;
}

/** Run-1 outcome counts of a mode over the sample. */
export interface CoverageAggregate {
  sampled: number;
  ok: number;
  failed: number;
  failedByKind: Record<FailureKind, number>;
  /** Sampled pairs with no run-1 record (not run, or stopped on budget). */
  missing: number;
}

export interface AgreementAggregate {
  /** Ok run-1 pairs. */
  n: number;
  spearman: ConfidenceInterval;
  mae: ConfidenceInterval;
  /** Positive: the scorer runs higher than the rule. */
  meanSignedError: Maybe;
  perBandMae: Record<Band, Maybe>;
  perBandN: Record<Band, number>;
  /** Share of pairs where the scorer's band equals the rule's (unweighted). */
  bandAgreement: Maybe;
  kappa: ConfidenceInterval;
  quadraticKappa: Maybe;
  /** Population view: each pair weighted by its band's sampling weight. */
  weightedMae: Maybe;
  weightedBandAgreement: Maybe;
  /** Rows: rule band, columns: scorer band, `BANDS` order. */
  confusion: ConfusionMatrix;
}

export interface DudeAgreement {
  /** Labelled spot-check pairs with an ok run-1 score in this mode. */
  pairs: number;
  /** First rater Dude, second rater the scorer. */
  scorer: BandKappas;
  /** The rule against Dude on the same pairs. */
  rule: BandKappas;
  /** The rule against Dude on every labelled spot-check pair of the sample. */
  ruleAll: BandKappas;
}

export interface NoiseAggregate {
  /** Pairs with an ok score in both runs. */
  pairs: number;
  /** Mean |run 2 - run 1|: the test-retest MAE. */
  meanAbsDelta: Maybe;
  spearman: Maybe;
  maxAbsDelta: Maybe;
  /** Mean of (run 2 - run 1). */
  meanSignedDelta: Maybe;
}

export interface GroundingAggregate {
  /** Which jobs are counted: run 1 and run 2 of the mode. */
  runs: 'run 1 and run 2';
  jobs: number;
  ok: number;
  /** Ok scores that needed the in-job retry (`attempts` = 2). */
  okAfterRetry: number;
  /** Ok scores with at least one criterion set to 0 for lack of evidence. */
  zeroedScores: number;
  /** Criteria set to 0 for lack of evidence, over all ok scores. */
  zeroedCriteria: number;
  groundingFailures: number;
  /** Reported apart and left out of both rates. */
  apiFailures: number;
  parseFailures: number;
  /** (okAfterRetry + groundingFailures) / (ok + groundingFailures). */
  firstPassFailureRate: Maybe;
  /** groundingFailures / (ok + groundingFailures). */
  afterRetryFailureRate: Maybe;
  buckets: Record<GroundingBucket, number>;
}

export interface CostAggregate {
  /** Ok scores (run 1 and run 2). */
  okScores: number;
  meanInputTokens: Maybe;
  meanOutputTokens: Maybe;
  /** Mean chat cost per ok score (embeddings not included). */
  meanCostUsd: Maybe;
  totalCostUsd: number;
}

export interface G4Aggregate {
  /** github_only-met tags over ok run-1 records. */
  tags: number;
  mapped: number;
  unmapped: number;
  credited: number;
  citedGithub: number;
  /** credited over mapped. */
  creditedShare: Maybe;
  /** citedGithub over mapped. */
  citedGithubShare: Maybe;
}

export interface SliceAggregate {
  n: number;
  mae: Maybe;
  meanSignedError: Maybe;
}

/** uk, keyword stuffers and injection personas overlap; `rest` is none of them. */
export const SLICE_NAMES = [
  'uk',
  'keywordStuffers',
  'injection',
  'rest',
] as const;
export type SliceName = (typeof SLICE_NAMES)[number];

export interface ModeAggregate {
  mode: ScoringMode;
  coverage: CoverageAggregate;
  agreement: AgreementAggregate;
  vsDude: DudeAgreement | null;
  noise: NoiseAggregate;
  grounding: GroundingAggregate;
  cost: CostAggregate;
  g4: G4Aggregate;
  slices: Record<SliceName, SliceAggregate>;
}

/** full_text minus rag over the pairs ok in both modes (run 1). */
export interface PairedAggregate {
  pairs: number;
  spearman: ConfidenceInterval;
  mae: ConfidenceInterval;
  kappa: ConfidenceInterval;
}

export interface PairRow {
  vacancyId: string;
  personaId: string;
  band: Band;
  /** The rule's score. */
  rule: number;
  weight: number;
  /** Dude's band for spot-check pairs. */
  spotCheck: Band | null;
  scores: Record<
    ScoringMode,
    {
      run1: number | null;
      run2: number | null;
      /** Run 1 failure kind, if it failed. */
      failure: FailureKind | null;
    }
  >;
}

export interface ScoringAggregate {
  perMode: Record<ScoringMode, ModeAggregate | null>;
  paired: PairedAggregate | null;
  pairs: PairRow[];
  reviews: ReviewAggregate[];
  /** Cache records whose pair is not in the sample (a different seed or weak count). */
  unmatchedRecords: number;
}

export interface BaselineAggregate {
  label: string;
  generatedAt: string;
  sample: SampleInfo;
  /** `null`: the retrieval part was not run for this label. */
  retrieval: RetrievalResult | null;
  /** `null`: no scoring records for this label. */
  scoring: ScoringAggregate | null;
  runs: RunLogEntry[];
  /** Sum of the metered spend of every logged invocation. */
  meteredUsd: number;
  pricingCaveat: string;
}

export interface AggregateInput {
  label: string;
  generatedAt: string;
  sample: EvalSample;
  /** How the sample was built (stored in the aggregate). */
  sampleParams: { weak: number; noise: number };
  dataset: G4Dataset;
  /** Records of the cache; empty when scoring was not run. */
  records: readonly ScoreJobRecord[];
  retrieval: RetrievalResult | null;
  runs: readonly RunLogEntry[];
  reviews?: readonly ReviewAggregate[];
}

// --- Helpers -----------------------------------------------------------------

const NO_CI: ConfidenceInterval = {
  estimate: null,
  lo: null,
  hi: null,
  resamples: 0,
  valid: 0,
};

/** Bootstrap CI that is all-null for an empty sample (no resampling of nothing). */
function ci(
  rows: readonly AgreementRow[],
  statistic: (rows: readonly AgreementRow[]) => Maybe,
  seed: number,
): ConfidenceInterval {
  return rows.length === 0 ? NO_CI : bootstrapCi(rows, statistic, { seed });
}

const emptyBandCounts = (): Record<Band, number> => ({
  strong: 0,
  partial: 0,
  weak: 0,
});

const share = (part: number, whole: number): Maybe =>
  whole === 0 ? null : part / whole;

type RecordIndex = Map<string, ScoreJobRecord>;

const indexKey = (
  pair: { vacancyId: string; personaId: string },
  mode: ScoringMode,
  run: 1 | 2,
): string => `${pairKey(pair)}|${mode}|${run}`;

function okRecord(
  index: RecordIndex,
  pair: SampledPair,
  mode: ScoringMode,
  run: 1 | 2,
): ScoreOkRecord | null {
  const record = index.get(indexKey(pair, mode, run));
  return record?.status === 'ok' ? record : null;
}

const agreementRow = (
  pair: SampledPair,
  record: ScoreOkRecord,
): AgreementRow => ({
  predicted: record.overall,
  actual: pair.score,
  band: pair.band,
  weight: pair.weight,
});

// --- Per mode ----------------------------------------------------------------

function coverageOf(
  sample: readonly SampledPair[],
  index: RecordIndex,
  mode: ScoringMode,
): CoverageAggregate {
  const failedByKind: Record<FailureKind, number> = {
    grounding: 0,
    api: 0,
    parse: 0,
  };
  let ok = 0;
  let missing = 0;
  for (const pair of sample) {
    const record = index.get(indexKey(pair, mode, 1));
    if (!record) missing++;
    else if (record.status === 'ok') ok++;
    else failedByKind[record.failure.kind]++;
  }
  return {
    sampled: sample.length,
    ok,
    failed: failedByKind.grounding + failedByKind.api + failedByKind.parse,
    failedByKind,
    missing,
  };
}

function agreementOf(
  rows: readonly AgreementRow[],
  seed: number,
): AgreementAggregate {
  const bandPairs = scorerBandPairs(rows);
  const kappas = bandKappas(bandPairs);
  const perBandN = emptyBandCounts();
  for (const row of rows) perBandN[row.band]++;
  return {
    n: rows.length,
    spearman: ci(rows, spearmanOf, seed),
    mae: ci(rows, maeOf, seed),
    meanSignedError: meanSignedError(
      rows.map((r) => r.predicted),
      rows.map((r) => r.actual),
    ),
    perBandMae: perBandMae(rows),
    perBandN,
    bandAgreement: kappas.exactAgreement,
    kappa: ci(rows, kappaOf, seed),
    quadraticKappa: quadraticKappaOf(rows),
    weightedMae: weightedMae(rows),
    weightedBandAgreement: weightedBandAgreement(rows),
    confusion: kappas.confusion,
  };
}

function dudeOf(
  sample: readonly SampledPair[],
  index: RecordIndex,
  mode: ScoringMode,
): DudeAgreement | null {
  const labelled = sample.filter((p) => p.spotCheck !== null);
  const scored = labelled.flatMap((pair) => {
    const record = okRecord(index, pair, mode, 1);
    return record ? [{ pair, record }] : [];
  });
  if (scored.length === 0) return null;
  const dude = (p: SampledPair): Band => p.spotCheck as Band;
  const scorerPairs: BandPair[] = scored.map(({ pair, record }) => ({
    rule: dude(pair),
    human: bandOf(record.overall),
  }));
  const rulePairs = (pairs: readonly SampledPair[]): BandPair[] =>
    pairs.map((p) => ({ rule: dude(p), human: p.band }));
  return {
    pairs: scored.length,
    scorer: bandKappas(scorerPairs),
    rule: bandKappas(rulePairs(scored.map((s) => s.pair))),
    ruleAll: bandKappas(rulePairs(labelled)),
  };
}

function noiseOf(
  sample: readonly SampledPair[],
  index: RecordIndex,
  mode: ScoringMode,
): NoiseAggregate {
  const first: number[] = [];
  const second: number[] = [];
  for (const pair of sample) {
    const a = okRecord(index, pair, mode, 1);
    const b = okRecord(index, pair, mode, 2);
    if (a && b) {
      first.push(a.overall);
      second.push(b.overall);
    }
  }
  const deltas = second.map((v, i) => Math.abs(v - first[i]));
  return {
    pairs: first.length,
    meanAbsDelta: mae(second, first),
    spearman: spearman(first, second),
    maxAbsDelta: deltas.length === 0 ? null : Math.max(...deltas),
    meanSignedDelta: meanSignedError(second, first),
  };
}

function groundingOf(records: readonly ScoreJobRecord[]): GroundingAggregate {
  let ok = 0;
  let okAfterRetry = 0;
  let zeroedScores = 0;
  let zeroedCriteria = 0;
  let groundingFailures = 0;
  let apiFailures = 0;
  let parseFailures = 0;
  for (const record of records) {
    if (record.status === 'ok') {
      ok++;
      if (record.attempts === 2) okAfterRetry++;
      const zeroed = record.zeroedCriteria?.length ?? 0;
      if (zeroed > 0) zeroedScores++;
      zeroedCriteria += zeroed;
    } else if (record.failure.kind === 'grounding') groundingFailures++;
    else if (record.failure.kind === 'api') apiFailures++;
    else parseFailures++;
  }
  const denominator = ok + groundingFailures;
  return {
    runs: 'run 1 and run 2',
    jobs: records.length,
    ok,
    okAfterRetry,
    zeroedScores,
    zeroedCriteria,
    groundingFailures,
    apiFailures,
    parseFailures,
    firstPassFailureRate: share(okAfterRetry + groundingFailures, denominator),
    afterRetryFailureRate: share(groundingFailures, denominator),
    buckets: groundingBucketCounts(records),
  };
}

function costOf(records: readonly ScoreJobRecord[]): CostAggregate {
  const ok = records.filter((r): r is ScoreOkRecord => r.status === 'ok');
  return {
    okScores: ok.length,
    meanInputTokens: mean(ok.map((r) => r.inputTokens)),
    meanOutputTokens: mean(ok.map((r) => r.outputTokens)),
    meanCostUsd: mean(ok.map((r) => r.costUsd)),
    totalCostUsd: ok.reduce((sum, r) => sum + r.costUsd, 0),
  };
}

function g4Of(
  records: readonly ScoreOkRecord[],
  dataset: G4Dataset,
): G4Aggregate {
  let tags = 0;
  let mapped = 0;
  let credited = 0;
  let citedGithub = 0;
  for (const record of records) {
    for (const result of g4ForRecord(record, dataset)) {
      tags++;
      if (!result.mapped) continue;
      mapped++;
      if (result.credited) credited++;
      if (result.citedGithub) citedGithub++;
    }
  }
  return {
    tags,
    mapped,
    unmapped: tags - mapped,
    credited,
    citedGithub,
    creditedShare: share(credited, mapped),
    citedGithubShare: share(citedGithub, mapped),
  };
}

function slicesOf(
  rows: ReadonlyArray<{ row: AgreementRow; persona: PersonaSpec | undefined }>,
): Record<SliceName, SliceAggregate> {
  const member: Record<SliceName, (p: PersonaSpec | undefined) => boolean> = {
    uk: (p) => p?.language === 'uk',
    keywordStuffers: (p) => p?.flags.includes('keyword_stuffer') ?? false,
    injection: (p) => p?.flags.includes('injection') ?? false,
    rest: (p) =>
      !member.uk(p) && !member.keywordStuffers(p) && !member.injection(p),
  };
  const out = {} as Record<SliceName, SliceAggregate>;
  for (const name of SLICE_NAMES) {
    const subset = rows
      .filter((r) => member[name](r.persona))
      .map((r) => r.row);
    out[name] = {
      n: subset.length,
      mae: maeOf(subset),
      meanSignedError: meanSignedError(
        subset.map((r) => r.predicted),
        subset.map((r) => r.actual),
      ),
    };
  }
  return out;
}

function modeAggregate(
  mode: ScoringMode,
  input: AggregateInput,
  index: RecordIndex,
  inSample: readonly ScoreJobRecord[],
): ModeAggregate {
  const { sample, dataset } = input;
  const seed = sample.seed;
  const run1: Array<{ pair: SampledPair; record: ScoreOkRecord }> = [];
  for (const pair of sample.pairs) {
    const record = okRecord(index, pair, mode, 1);
    if (record) run1.push({ pair, record });
  }
  const rows = run1.map(({ pair, record }) => agreementRow(pair, record));
  const personas = new Map(dataset.personas.map((p) => [p.id, p]));
  const ofMode = inSample.filter((r) => r.mode === mode);
  return {
    mode,
    coverage: coverageOf(sample.pairs, index, mode),
    agreement: agreementOf(rows, seed),
    vsDude: dudeOf(sample.pairs, index, mode),
    noise: noiseOf(sample.pairs, index, mode),
    grounding: groundingOf(ofMode),
    cost: costOf(ofMode),
    g4: g4Of(
      run1.map((r) => r.record),
      dataset,
    ),
    slices: slicesOf(
      run1.map(({ pair, record }) => ({
        row: agreementRow(pair, record),
        persona: personas.get(record.personaId),
      })),
    ),
  };
}

function pairedOf(
  sample: readonly SampledPair[],
  index: RecordIndex,
  seed: number,
): PairedAggregate {
  const a: AgreementRow[] = [];
  const b: AgreementRow[] = [];
  for (const pair of sample) {
    const full = okRecord(index, pair, 'full_text', 1);
    const rag = okRecord(index, pair, 'rag', 1);
    if (full && rag) {
      a.push(agreementRow(pair, full));
      b.push(agreementRow(pair, rag));
    }
  }
  const diff = (
    statistic: (rows: readonly AgreementRow[]) => Maybe,
  ): ConfidenceInterval =>
    a.length === 0 ? NO_CI : bootstrapDifference(a, b, statistic, { seed });
  return {
    pairs: a.length,
    spearman: diff(spearmanOf),
    mae: diff(maeOf),
    kappa: diff(kappaOf),
  };
}

function pairRows(
  sample: readonly SampledPair[],
  index: RecordIndex,
): PairRow[] {
  const cell = (
    pair: SampledPair,
    mode: ScoringMode,
  ): PairRow['scores'][ScoringMode] => {
    const r1 = index.get(indexKey(pair, mode, 1));
    const r2 = index.get(indexKey(pair, mode, 2));
    return {
      run1: r1?.status === 'ok' ? r1.overall : null,
      run2: r2?.status === 'ok' ? r2.overall : null,
      failure: r1?.status === 'failed' ? r1.failure.kind : null,
    };
  };
  return sample.map((pair) => ({
    vacancyId: pair.vacancyId,
    personaId: pair.personaId,
    band: pair.band,
    rule: pair.score,
    weight: pair.weight,
    spotCheck: pair.spotCheck,
    scores: { full_text: cell(pair, 'full_text'), rag: cell(pair, 'rag') },
  }));
}

// --- Entry point -------------------------------------------------------------

export function buildAggregate(input: AggregateInput): BaselineAggregate {
  const { sample } = input;
  const sampleKeys = new Set(sample.pairs.map(pairKey));
  const inSample = input.records.filter((r) => sampleKeys.has(pairKey(r)));
  const index: RecordIndex = new Map(
    inSample.map((r) => [indexKey(r, r.mode, r.run), r]),
  );

  let scoring: ScoringAggregate | null = null;
  if (input.records.length > 0) {
    const perMode = Object.fromEntries(
      SCORING_MODES.map((mode) => [
        mode,
        inSample.some((r) => r.mode === mode)
          ? modeAggregate(mode, input, index, inSample)
          : null,
      ]),
    ) as Record<ScoringMode, ModeAggregate | null>;
    scoring = {
      perMode,
      paired:
        perMode.full_text && perMode.rag
          ? pairedOf(sample.pairs, index, sample.seed)
          : null,
      pairs: pairRows(sample.pairs, index),
      reviews: [...(input.reviews ?? [])],
      unmatchedRecords: input.records.length - inSample.length,
    };
  }

  return {
    label: input.label,
    generatedAt: input.generatedAt,
    sample: {
      seed: sample.seed,
      weak: input.sampleParams.weak,
      noise: input.sampleParams.noise,
      population: sample.population,
      sampled: sample.sampled,
      pairs: sample.pairs.length,
      spotCheckPairs: sample.pairs.filter((p) => p.spotCheck !== null).length,
    },
    retrieval: input.retrieval,
    scoring,
    runs: [...input.runs],
    meteredUsd: input.runs.reduce((sum, r) => sum + r.spentUsd, 0),
    pricingCaveat: PRICING_CAVEAT,
  };
}
