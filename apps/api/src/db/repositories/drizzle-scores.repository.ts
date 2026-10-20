import { Injectable } from '@nestjs/common';
import type { ApplicationScore } from '@rag-ats/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { toApplicationScore } from './score.mapper.js';
import { applicationScores, applications, candidates } from '../schema.js';
import type {
  SavedScore,
  ScoreState,
  ScoresRepository,
} from './scores.repository.js';

@Injectable()
export class DrizzleScoresRepository implements ScoresRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx must be read fresh on every call, never cached on `this` -
  // it resolves to the current AsyncLocalStorage-backed transaction (or the
  // base db outside one), and this class is a singleton shared across requests.
  async createPending(applicationId: string): Promise<void> {
    await this.txHost.tx
      .insert(applicationScores)
      .values({ applicationId })
      .onConflictDoNothing();
  }

  async findScoreState(applicationId: string): Promise<ScoreState | null> {
    const row = await this.txHost.tx.query.applications.findFirst({
      where: { id: applicationId },
      columns: { id: true, vacancyId: true, candidateId: true },
      with: {
        score: {
          columns: { status: true, cvDocumentId: true, criteriaHash: true },
        },
        candidate: {
          columns: { parseStatus: true, parsedCvDocumentId: true },
        },
        vacancy: {
          columns: {
            title: true,
            requirements: true,
            criteria: true,
            criteriaHash: true,
          },
        },
      },
    });
    if (!row?.score) return null;
    return {
      applicationId: row.id,
      vacancyId: row.vacancyId,
      candidateId: row.candidateId,
      status: row.score.status,
      candidateParseStatus: row.candidate.parseStatus,
      candidateParsedCvDocumentId: row.candidate.parsedCvDocumentId,
      vacancyTitle: row.vacancy.title,
      vacancyRequirements: row.vacancy.requirements,
      vacancyCriteria: row.vacancy.criteria,
      vacancyCriteriaHash: row.vacancy.criteriaHash,
      scoreCvDocumentId: row.score.cvDocumentId,
      scoreCriteriaHash: row.score.criteriaHash,
    };
  }

  async findApplicationScore(
    applicationId: string,
  ): Promise<ApplicationScore | null> {
    const row = await this.txHost.tx.query.applications.findFirst({
      where: { id: applicationId },
      columns: { id: true },
      with: {
        score: true,
        candidate: {
          columns: { parseStatus: true, parsedCvDocumentId: true },
        },
        vacancy: { columns: { criteriaHash: true } },
      },
    });
    if (!row) return null;
    return toApplicationScore(row.score, {
      candidateParseStatus: row.candidate.parseStatus,
      candidateParsedCvDocumentId: row.candidate.parsedCvDocumentId,
      vacancyCriteriaHash: row.vacancy.criteriaHash,
    });
  }

  async markScoring(applicationId: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(applicationScores)
      .set({ status: 'scoring', error: null, updatedAt: new Date() })
      .where(
        and(
          eq(applicationScores.applicationId, applicationId),
          inArray(applicationScores.status, ['pending', 'failed', 'scoring']),
        ),
      )
      .returning({ applicationId: applicationScores.applicationId });
    return rows.length > 0;
  }

  async saveResult(applicationId: string, saved: SavedScore): Promise<void> {
    const now = new Date();
    await this.txHost.tx
      .update(applicationScores)
      .set({
        status: 'scored',
        error: null,
        result: saved.result,
        cvDocumentId: saved.cvDocumentId,
        criteriaHash: saved.criteriaHash,
        model: saved.model,
        mode: saved.mode,
        inputTokens: saved.inputTokens,
        outputTokens: saved.outputTokens,
        scoredAt: now,
        updatedAt: now,
      })
      .where(eq(applicationScores.applicationId, applicationId));
  }

  async markFailed(applicationId: string, error: string): Promise<void> {
    await this.txHost.tx
      .update(applicationScores)
      .set({ status: 'failed', error, updatedAt: new Date() })
      .where(eq(applicationScores.applicationId, applicationId));
  }

  async resetToPending(applicationId: string): Promise<void> {
    await this.txHost.tx
      .update(applicationScores)
      .set({ status: 'pending', error: null, updatedAt: new Date() })
      .where(eq(applicationScores.applicationId, applicationId));
  }

  async resetPendingForCandidate(candidateId: string): Promise<string[]> {
    const rows = await this.txHost.tx
      .update(applicationScores)
      .set({ status: 'pending', error: null, updatedAt: new Date() })
      .where(
        inArray(
          applicationScores.applicationId,
          this.txHost.tx
            .select({ id: applications.id })
            .from(applications)
            .where(eq(applications.candidateId, candidateId)),
        ),
      )
      .returning({ applicationId: applicationScores.applicationId });
    return rows.map((row) => row.applicationId);
  }

  async findPendingByVacancy(vacancyId: string): Promise<string[]> {
    const rows = await this.txHost.tx
      .select({ applicationId: applicationScores.applicationId })
      .from(applicationScores)
      .innerJoin(
        applications,
        eq(applications.id, applicationScores.applicationId),
      )
      .where(
        and(
          eq(applications.vacancyId, vacancyId),
          eq(applicationScores.status, 'pending'),
        ),
      );
    return rows.map((row) => row.applicationId);
  }

  async findBacklog(): Promise<string[]> {
    const rows = await this.txHost.tx
      .select({ applicationId: applicationScores.applicationId })
      .from(applicationScores)
      .innerJoin(
        applications,
        eq(applications.id, applicationScores.applicationId),
      )
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .where(
        and(
          inArray(applicationScores.status, ['pending', 'scoring']),
          eq(candidates.parseStatus, 'parsed'),
        ),
      );
    return rows.map((row) => row.applicationId);
  }
}
