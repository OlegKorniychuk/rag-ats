import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, inArray } from 'drizzle-orm';
import type { ParseStatus } from '@rag-ats/shared';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { candidates } from '../schema.js';
import { latestCvSummaryWith, withCv } from './cv-summary.mapper.js';
import {
  publicCandidateColumns,
  publicCandidateColumnsWith,
} from './candidates.repository.js';
import type {
  CandidateParseState,
  ParsedProfile,
  NewCandidate,
  Candidate,
  CandidateRow,
  CandidatesRepository,
} from './candidates.repository.js';

@Injectable()
export class DrizzleCandidatesRepository implements CandidatesRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx must be read fresh on every call, never cached on `this` -
  // it resolves to the current AsyncLocalStorage-backed transaction (or the
  // base db outside one), and this class is a singleton shared across requests.
  async create(data: NewCandidate): Promise<CandidateRow> {
    const [row] = await this.txHost.tx
      .insert(candidates)
      .values(data)
      .returning(publicCandidateColumns);
    return row;
  }

  async findAll(): Promise<Candidate[]> {
    const rows = await this.txHost.tx.query.candidates.findMany({
      columns: publicCandidateColumnsWith,
      with: latestCvSummaryWith,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(withCv);
  }

  async findById(id: string): Promise<Candidate | null> {
    const row = await this.txHost.tx.query.candidates.findFirst({
      where: { id },
      columns: publicCandidateColumnsWith,
      with: latestCvSummaryWith,
    });
    return row ? withCv(row) : null;
  }

  async findByEmail(email: string): Promise<Candidate | null> {
    const row = await this.txHost.tx.query.candidates.findFirst({
      where: { email },
      columns: publicCandidateColumnsWith,
      with: latestCvSummaryWith,
    });
    return row ? withCv(row) : null;
  }

  async update(id: string, data: Partial<NewCandidate>): Promise<CandidateRow> {
    const [row] = await this.txHost.tx
      .update(candidates)
      .set(data)
      .where(eq(candidates.id, id))
      .returning(publicCandidateColumns);
    return row;
  }

  async setParseStatus(
    id: string,
    status: ParseStatus,
    error: string | null = null,
  ): Promise<void> {
    await this.txHost.tx
      .update(candidates)
      .set({ parseStatus: status, parseError: error })
      .where(eq(candidates.id, id));
  }

  async markParsing(id: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(candidates)
      .set({ parseStatus: 'parsing', parseError: null })
      .where(
        and(
          eq(candidates.id, id),
          inArray(candidates.parseStatus, ['pending', 'failed', 'parsing']),
        ),
      )
      .returning({ id: candidates.id });
    return rows.length > 0;
  }

  async saveParsedProfile(
    id: string,
    cvDocumentId: string,
    profile: ParsedProfile,
  ): Promise<void> {
    await this.txHost.tx
      .update(candidates)
      .set({
        skills: profile.skills,
        experience: profile.experience,
        projects: profile.projects,
        summary: profile.summary,
        parseStatus: 'parsed',
        parseError: null,
        parsedCvDocumentId: cvDocumentId,
        parsedAt: new Date(),
      })
      .where(eq(candidates.id, id));
  }

  async findParseState(id: string): Promise<CandidateParseState | null> {
    const row = await this.txHost.tx.query.candidates.findFirst({
      where: { id },
      columns: { id: true, parseStatus: true, parsedCvDocumentId: true },
      with: {
        cvDocuments: {
          columns: { id: true },
          orderBy: { createdAt: 'desc' },
          limit: 1,
        },
      },
    });
    const latest = row?.cvDocuments[0];
    if (!row || !latest) return null;
    return {
      id: row.id,
      parseStatus: row.parseStatus,
      parsedCvDocumentId: row.parsedCvDocumentId,
      latestCvDocumentId: latest.id,
    };
  }

  async findParseBacklog(): Promise<
    Array<{ candidateId: string; cvDocumentId: string }>
  > {
    const rows = await this.txHost.tx.query.candidates.findMany({
      where: { parseStatus: { in: ['pending', 'parsing'] } },
      columns: { id: true },
      with: {
        cvDocuments: {
          columns: { id: true },
          orderBy: { createdAt: 'desc' },
          limit: 1,
        },
      },
    });
    return rows.flatMap((row) =>
      row.cvDocuments[0]
        ? [{ candidateId: row.id, cvDocumentId: row.cvDocuments[0].id }]
        : [],
    );
  }
}
