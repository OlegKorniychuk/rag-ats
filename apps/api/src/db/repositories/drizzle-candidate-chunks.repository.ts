import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { cosineDistance, eq, notInArray, sql } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { applications, candidateChunks } from '../schema.js';
import type {
  CandidateChunksRepository,
  ChunkHit,
  FindNearestOptions,
  NewCandidateChunk,
} from './candidate-chunks.repository.js';

@Injectable()
export class DrizzleCandidateChunksRepository implements CandidateChunksRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx must be read fresh on every call, never cached on `this` -
  // it resolves to the current AsyncLocalStorage-backed transaction (or the
  // base db outside one), and this class is a singleton shared across requests.
  async replaceForCandidate(
    candidateId: string,
    cvDocumentId: string,
    chunks: NewCandidateChunk[],
    model: string,
  ): Promise<void> {
    await this.txHost.tx
      .delete(candidateChunks)
      .where(eq(candidateChunks.candidateId, candidateId));
    if (chunks.length === 0) return;
    await this.txHost.tx.insert(candidateChunks).values(
      chunks.map((chunk, index) => ({
        candidateId,
        cvDocumentId,
        source: chunk.source,
        chunkIndex: index,
        text: chunk.text,
        embedding: chunk.embedding,
        model,
      })),
    );
  }

  async findNearest(
    embedding: number[],
    limit: number,
    options: FindNearestOptions = {},
  ): Promise<ChunkHit[]> {
    const distance = cosineDistance(candidateChunks.embedding, embedding);
    const rows = await this.txHost.tx
      .select({
        candidateId: candidateChunks.candidateId,
        source: candidateChunks.source,
        text: candidateChunks.text,
        similarity: sql<number>`1 - (${distance})`,
      })
      .from(candidateChunks)
      .where(
        options.excludeVacancyId
          ? notInArray(
              candidateChunks.candidateId,
              this.txHost.tx
                .select({ candidateId: applications.candidateId })
                .from(applications)
                .where(eq(applications.vacancyId, options.excludeVacancyId)),
            )
          : undefined,
      )
      .orderBy(distance)
      .limit(limit);
    return rows.map((row) => ({
      candidateId: row.candidateId,
      source: row.source as ChunkHit['source'],
      text: row.text,
      similarity: Number(row.similarity),
    }));
  }
}
