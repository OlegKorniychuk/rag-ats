import type { InterviewQuestion } from '@rag-ats/shared';
import { costUsd, type Pricing } from '../parse-eval/cost.js';
import type { Band } from '../synth/types.js';
import { BANDS, type QuestionsSampleItem } from './sample.js';

/** One application's generation in the eval. */
export interface QuestionsRecord {
  item: QuestionsSampleItem;
  status: 'ok' | 'failed';
  /** Model calls the result took; null when failed. */
  attempts: 1 | 2 | null;
  /** The safe error message of a failure. */
  error: string | null;
  questions: InterviewQuestion[];
  /** criterion id -> its fit score. */
  criterionScores: Record<string, number>;
  /** criterion id -> the quote texts the fit score cited for it. */
  scoreCitedTexts: Record<string, string[]>;
  inputTokens: number;
  outputTokens: number;
}

export interface QuestionsMetrics {
  applications: number;
  ok: number;
  /** Ok after a grounding retry. */
  retried: number;
  failed: number;
  /** Over ok applications; all 0 when none. */
  questionsPerApp: { mean: number; min: number; max: number };
  basisByBand: Record<Band, { fact: number; gap: number }>;
  /** Gap questions on a criterion scored below 50 ÷ gap questions; null without gaps. */
  gapOnLowCriterion: number | null;
  /** Fact questions with a quote the score also cited for that criterion ÷ fact questions; null without facts. */
  factCitesScoreUnit: number | null;
  costUsd: number;
}

export const LOW_CRITERION_SCORE = 50;

const share = (hits: number, total: number): number | null =>
  total === 0 ? null : hits / total;

export function computeQuestionsMetrics(
  records: QuestionsRecord[],
  pricing: Pricing,
): QuestionsMetrics {
  const ok = records.filter((r) => r.status === 'ok');
  const counts = ok.map((r) => r.questions.length);
  const basisByBand = Object.fromEntries(
    BANDS.map((band) => [band, { fact: 0, gap: 0 }]),
  ) as QuestionsMetrics['basisByBand'];

  let gaps = 0;
  let lowGaps = 0;
  let facts = 0;
  let citedFacts = 0;
  for (const record of ok) {
    for (const question of record.questions) {
      basisByBand[record.item.band][question.basis] += 1;
      if (question.basis === 'gap') {
        gaps += 1;
        const score = record.criterionScores[question.criterionId];
        if (score !== undefined && score < LOW_CRITERION_SCORE) lowGaps += 1;
      } else {
        facts += 1;
        const cited = new Set(record.scoreCitedTexts[question.criterionId]);
        if (question.quotes.some((q) => cited.has(q.text))) citedFacts += 1;
      }
    }
  }

  return {
    applications: records.length,
    ok: ok.length,
    retried: ok.filter((r) => r.attempts === 2).length,
    failed: records.length - ok.length,
    questionsPerApp:
      counts.length === 0
        ? { mean: 0, min: 0, max: 0 }
        : {
            mean: counts.reduce((a, b) => a + b, 0) / counts.length,
            min: Math.min(...counts),
            max: Math.max(...counts),
          },
    basisByBand,
    gapOnLowCriterion: share(lowGaps, gaps),
    factCitesScoreUnit: share(citedFacts, facts),
    costUsd: records.reduce(
      (sum, r) =>
        sum +
        costUsd(
          {
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            totalTokens: r.inputTokens + r.outputTokens,
            model: '',
          },
          pricing,
        ),
      0,
    ),
  };
}
