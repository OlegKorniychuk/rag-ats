import { Injectable } from '@nestjs/common';
import type { ApplicationQuestions } from '@rag-ats/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';
import { toApplicationQuestions } from './questions.mapper.js';
import { interviewQuestions } from '../schema.js';
import type {
  QuestionState,
  QuestionsRepository,
  SavedQuestions,
} from './questions.repository.js';

@Injectable()
export class DrizzleQuestionsRepository implements QuestionsRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx is read fresh on every call (see DrizzleScoresRepository).
  async findState(applicationId: string): Promise<QuestionState | null> {
    const row = await this.txHost.tx.query.applications.findFirst({
      where: { id: applicationId },
      columns: { id: true, candidateId: true },
      with: {
        questions: { columns: { status: true } },
        score: {
          columns: {
            status: true,
            result: true,
            cvDocumentId: true,
            criteriaHash: true,
            scoredAt: true,
          },
        },
        candidate: { columns: { parsedCvDocumentId: true } },
        vacancy: { columns: { title: true, requirements: true } },
      },
    });
    if (!row) return null;
    return {
      applicationId: row.id,
      status: row.questions?.status ?? null,
      vacancyTitle: row.vacancy.title,
      vacancyRequirements: row.vacancy.requirements,
      candidateId: row.candidateId,
      candidateParsedCvDocumentId: row.candidate.parsedCvDocumentId,
      vacancyCriteriaHash: vacancyCriteriaHash(
        row.vacancy.title,
        row.vacancy.requirements,
      ),
      score: row.score
        ? {
            status: row.score.status,
            result: row.score.result,
            cvDocumentId: row.score.cvDocumentId,
            criteriaHash: row.score.criteriaHash,
            scoredAt: row.score.scoredAt,
          }
        : null,
    };
  }

  async findApplicationQuestions(
    applicationId: string,
  ): Promise<ApplicationQuestions> {
    const row = await this.txHost.tx.query.applications.findFirst({
      where: { id: applicationId },
      columns: { id: true },
      with: {
        questions: true,
        score: { columns: { scoredAt: true } },
        candidate: { columns: { parsedCvDocumentId: true } },
        vacancy: { columns: { title: true, requirements: true } },
      },
    });
    return toApplicationQuestions(row?.questions, {
      scoreScoredAt: row?.score?.scoredAt ?? null,
      candidateParsedCvDocumentId: row?.candidate.parsedCvDocumentId ?? null,
      vacancyCriteriaHash: row
        ? vacancyCriteriaHash(row.vacancy.title, row.vacancy.requirements)
        : null,
    });
  }

  async resetToPending(applicationId: string): Promise<void> {
    const now = new Date();
    await this.txHost.tx
      .insert(interviewQuestions)
      .values({ applicationId, status: 'pending', updatedAt: now })
      .onConflictDoUpdate({
        target: interviewQuestions.applicationId,
        set: { status: 'pending', error: null, updatedAt: now },
      });
  }

  async markGenerating(applicationId: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(interviewQuestions)
      .set({ status: 'generating', error: null, updatedAt: new Date() })
      .where(
        and(
          eq(interviewQuestions.applicationId, applicationId),
          inArray(interviewQuestions.status, ['pending', 'generating']),
        ),
      )
      .returning({ applicationId: interviewQuestions.applicationId });
    return rows.length > 0;
  }

  async saveResult(
    applicationId: string,
    saved: SavedQuestions,
  ): Promise<void> {
    const now = new Date();
    await this.txHost.tx
      .update(interviewQuestions)
      .set({
        status: 'ready',
        error: null,
        failureDetails: null,
        result: saved.result,
        cvDocumentId: saved.cvDocumentId,
        criteriaHash: saved.criteriaHash,
        scoreScoredAt: saved.scoreScoredAt,
        model: saved.model,
        inputTokens: saved.inputTokens,
        outputTokens: saved.outputTokens,
        generatedAt: now,
        updatedAt: now,
      })
      .where(eq(interviewQuestions.applicationId, applicationId));
  }

  async markFailed(
    applicationId: string,
    error: string,
    details: readonly string[] | null,
  ): Promise<void> {
    await this.txHost.tx
      .update(interviewQuestions)
      .set({
        status: 'failed',
        error,
        failureDetails: details ? [...details] : null,
        updatedAt: new Date(),
      })
      .where(eq(interviewQuestions.applicationId, applicationId));
  }

  async findBacklog(): Promise<string[]> {
    const rows = await this.txHost.tx
      .select({ applicationId: interviewQuestions.applicationId })
      .from(interviewQuestions)
      .where(inArray(interviewQuestions.status, ['pending', 'generating']));
    return rows.map((row) => row.applicationId);
  }
}
