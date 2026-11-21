import type {
  CriterionImportance,
  InterviewQuestion,
  ScoreQuote,
} from '@rag-ats/shared';
import type { InterviewQuestionsOutput } from '../llm/interview-questions.schema.js';
import type { EvidenceUnit } from './evidence-units.js';
import {
  MAX_QUOTES_PER_CRITERION,
  normaliseUnitId,
} from './resolve-citations.js';
import { preview } from './verify-quotes.js';

/** Most questions kept from one answer; later ones are dropped. */
export const MAX_QUESTIONS = 10;

/** A scored vacancy criterion the questions may target. */
export interface QuestionCriterion {
  id: string;
  text: string;
  importance: CriterionImportance;
  /** 0-100, from the fit score. */
  score: number;
}

/** The problem strings (1-based question index), exported for tests and the eval. */
export const questionProblems = {
  none: (): string => 'The answer contains no questions',
  unknownCriterion: (index: number, id: string): string =>
    `Question ${index} targets unknown criterion id ${preview(id)}`,
  unknownEvidence: (index: number, raw: string): string =>
    `Question ${index} cites unknown evidence id ${preview(raw)}`,
  factWithoutEvidence: (index: number): string =>
    `Question ${index} is a fact question but cites no evidence`,
  emptyText: (index: number): string => `Question ${index} has no text`,
};

export interface ResolveQuestionCitationsResult {
  valid: boolean;
  problems: string[];
  /** Not to be used when `valid` is false. */
  questions: InterviewQuestion[];
}

/**
 * Checks every question's criterion and cited unit IDs and resolves the IDs to
 * the units' verbatim text (deduplicated, at most 3). A fact question must cite
 * at least one unit. A gap on a criterion scored 50 or more is not a problem
 * (the eval measures it). Questions past MAX_QUESTIONS are dropped.
 */
export function resolveQuestionCitations(
  output: InterviewQuestionsOutput,
  units: ReadonlyMap<string, EvidenceUnit>,
  criteria: readonly QuestionCriterion[],
): ResolveQuestionCitationsResult {
  if (output.questions.length === 0) {
    return { valid: false, problems: [questionProblems.none()], questions: [] };
  }
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const problems: string[] = [];
  const questions: InterviewQuestion[] = [];

  output.questions.slice(0, MAX_QUESTIONS).forEach((question, i) => {
    const index = i + 1;
    const text = question.text.trim();
    if (!text) {
      problems.push(questionProblems.emptyText(index));
      return;
    }
    const criterion = byId.get(question.criterionId);
    if (!criterion) {
      problems.push(
        questionProblems.unknownCriterion(index, question.criterionId),
      );
      return;
    }

    const cited = new Set<string>();
    const quotes: ScoreQuote[] = [];
    for (const raw of question.evidence) {
      const unitId = normaliseUnitId(raw);
      if (cited.has(unitId)) continue;
      cited.add(unitId);
      const unit = units.get(unitId);
      if (!unit) {
        problems.push(questionProblems.unknownEvidence(index, raw));
      } else if (quotes.length < MAX_QUOTES_PER_CRITERION) {
        quotes.push({ source: unit.source, text: unit.text });
      }
    }
    if (question.basis === 'fact' && question.evidence.length === 0) {
      problems.push(questionProblems.factWithoutEvidence(index));
    }

    questions.push({
      text,
      basis: question.basis,
      criterionId: criterion.id,
      criterion: criterion.text,
      importance: criterion.importance,
      purpose: question.purpose.trim(),
      quotes,
    });
  });

  return { valid: problems.length === 0, problems, questions };
}
