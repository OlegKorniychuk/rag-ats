/**
 * The questions eval run: finds the seeded applications with a current score,
 * generates questions for a sample with the production `QuestionGenerator`
 * (in memory: nothing is written to the database) and writes the files.
 */
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import {
  APPLICATIONS_REPOSITORY,
  type ApplicationsRepository,
} from '../../db/repositories/applications.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../../db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../db/repositories/cv-documents.repository.js';
import {
  QUESTIONS_REPOSITORY,
  type QuestionsRepository,
} from '../../db/repositories/questions.repository.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../../db/repositories/scores.repository.js';
import {
  LlmQuestionError,
  QuestionGenerator,
} from '../../llm/question-generator.js';
import type { EvalDataset } from '../eval/preflight.js';
import { writeFormatted, writeJson } from '../eval/layout.js';
import { costUsd, DEFAULT_PRICING, type Pricing } from '../parse-eval/cost.js';
import type { SeedMeter } from '../seed/metering.js';
import {
  computeQuestionsMetrics,
  type QuestionsMetrics,
  type QuestionsRecord,
} from './metrics.js';
import { renderQuestionsReport, type QuestionsRunMeta } from './report.js';
import { buildQuestionsReview } from './review.js';
import type { QuestionsSampleItem } from './sample.js';

export const QUESTIONS_EVAL_DIR = 'docs/eval/questions';
/** Estimated cost of one generation before any has finished. */
export const FIRST_CALL_ESTIMATE_USD = 0.006;
export const GENERIC_EVAL_ERROR = 'Could not generate questions';

/**
 * Every ground-truth pair whose seeded application has a `scored`, current
 * (not stale) fit score, with its band. Read-only, no LLM call.
 */
export async function findQuestionsCandidates(
  app: INestApplicationContext,
  dataset: EvalDataset,
): Promise<QuestionsSampleItem[]> {
  const applications = app.get<ApplicationsRepository>(APPLICATIONS_REPOSITORY);
  const scores = app.get<ScoresRepository>(SCORES_REPOSITORY);
  const items: QuestionsSampleItem[] = [];
  for (const pair of dataset.groundTruth.pairs) {
    const vacancyId = dataset.vacancyIdBySpecId.get(pair.vacancyId);
    const candidateId = dataset.candidateIdByPersonaId.get(pair.personaId);
    if (!vacancyId || !candidateId) continue;
    const application = await applications.findByVacancyAndCandidate(
      vacancyId,
      candidateId,
    );
    if (!application) continue;
    const score = await scores.findApplicationScore(application.id);
    if (!score || score.status !== 'scored' || score.stale || !score.result) {
      continue;
    }
    items.push({
      applicationId: application.id,
      vacancySpecId: pair.vacancyId,
      personaId: pair.personaId,
      band: pair.band,
    });
  }
  return items;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface QuestionsRunOptions {
  maxUsd: number;
  meter: SeedMeter;
  log: (line: string) => void;
  pricing?: Pricing;
}

export interface QuestionsRunResult {
  records: QuestionsRecord[];
  /** 'budget' when the cap stopped the run before every item was done. */
  stopped: 'budget' | null;
}

/** Generates questions for each item in turn; stops before a call that could pass `maxUsd`. */
export async function runQuestionsEval(
  app: INestApplicationContext,
  items: QuestionsSampleItem[],
  options: QuestionsRunOptions,
): Promise<QuestionsRunResult> {
  const questions = app.get<QuestionsRepository>(QUESTIONS_REPOSITORY);
  const cvDocuments = app.get<CvDocumentsRepository>(CV_DOCUMENTS_REPOSITORY);
  const candidates = app.get<CandidatesRepository>(CANDIDATES_REPOSITORY);
  const generator = app.get(QuestionGenerator);
  const pricing = options.pricing ?? DEFAULT_PRICING;

  const records: QuestionsRecord[] = [];
  const costs: number[] = [];
  for (const [index, item] of items.entries()) {
    const estimate = costs.length > 0 ? median(costs) : FIRST_CALL_ESTIMATE_USD;
    if (options.meter.spentUsd + estimate > options.maxUsd) {
      options.log(
        `Budget: $${options.meter.spentUsd.toFixed(4)} spent, next call estimated at $${estimate.toFixed(4)}, cap $${options.maxUsd}; stopping with ${items.length - index} not started`,
      );
      return { records, stopped: 'budget' };
    }

    const state = await questions.findState(item.applicationId);
    const score = state?.score;
    if (!state || !score?.result || !score.cvDocumentId) {
      throw new Error(`No current score for application ${item.applicationId}`);
    }
    const criterionScores = Object.fromEntries(
      score.result.criteria.map((c) => [c.criterionId, c.score]),
    );
    const scoreCitedTexts = Object.fromEntries(
      score.result.criteria.map((c) => [
        c.criterionId,
        c.quotes.map((q) => q.text),
      ]),
    );
    const cvText = await cvDocuments.findTextById(score.cvDocumentId);
    if (cvText === null) throw new Error('CV document not found');
    const github = await candidates.findGithubSnapshot(state.candidateId);

    const label = `${index + 1}/${items.length} ${item.vacancySpecId}/${item.personaId} (${item.band})`;
    const spentBefore = options.meter.spentUsd;
    try {
      const generated = await generator.generate({
        vacancy: {
          title: state.vacancyTitle,
          requirements: state.vacancyRequirements,
        },
        score: score.result,
        cvText,
        github,
      });
      records.push({
        item,
        status: 'ok',
        attempts: generated.attempts,
        error: null,
        questions: generated.questions,
        criterionScores,
        scoreCitedTexts,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
      });
      costs.push(
        costUsd(
          {
            ...generated.usage,
            totalTokens:
              generated.usage.inputTokens + generated.usage.outputTokens,
          },
          pricing,
        ),
      );
      options.log(
        `${label}: ${generated.questions.length} question(s), ${generated.attempts} attempt(s)`,
      );
    } catch (err) {
      const error =
        err instanceof LlmQuestionError ? err.message : GENERIC_EVAL_ERROR;
      records.push({
        item,
        status: 'failed',
        attempts: null,
        error,
        questions: [],
        criterionScores,
        scoreCitedTexts,
        inputTokens: 0,
        outputTokens: 0,
      });
      costs.push(options.meter.spentUsd - spentBefore);
      options.log(`${label}: failed (${error})`);
    }
  }
  return { records, stopped: null };
}

export interface QuestionsEvalFiles {
  jsonPath: string;
  mdPath: string;
  reviewPath: string;
}

/** `<dir>/<label>.json` (records + metrics), `<label>.md`, `<label>.review.md`. */
export async function writeQuestionsEvalFiles(params: {
  dir: string;
  label: string;
  records: QuestionsRecord[];
  pricing: Pricing;
  meta: QuestionsRunMeta;
  reviewCount: number;
}): Promise<QuestionsEvalFiles & { metrics: QuestionsMetrics }> {
  const { dir, label, records, pricing, meta, reviewCount } = params;
  const metrics = computeQuestionsMetrics(records, pricing);
  const jsonPath = join(dir, `${label}.json`);
  const mdPath = join(dir, `${label}.md`);
  const reviewPath = join(dir, `${label}.review.md`);
  await writeJson(jsonPath, { label, meta, metrics, records });
  await writeFormatted(
    mdPath,
    renderQuestionsReport(label, metrics, meta),
    'markdown',
  );
  await writeFormatted(
    reviewPath,
    buildQuestionsReview(records, reviewCount, meta.seed),
    'markdown',
  );
  return { jsonPath, mdPath, reviewPath, metrics };
}
