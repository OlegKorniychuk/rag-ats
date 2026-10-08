import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { cvDocuments } from '../schema.js';
import type {
  CvDocumentsRepository,
  CvDocumentSummary,
  NewCvDocument,
} from './cv-documents.repository.js';

@Injectable()
export class DrizzleCvDocumentsRepository implements CvDocumentsRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx must be read fresh on every call, never cached on `this` -
  // it resolves to the current AsyncLocalStorage-backed transaction (or the
  // base db outside one), and this class is a singleton shared across requests.
  async create(data: NewCvDocument): Promise<CvDocumentSummary> {
    const [row] = await this.txHost.tx
      .insert(cvDocuments)
      .values(data)
      .returning({
        id: cvDocuments.id,
        filename: cvDocuments.filename,
        sizeBytes: cvDocuments.sizeBytes,
        createdAt: cvDocuments.createdAt,
      });
    return {
      id: row.id,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.createdAt,
    };
  }

  async findLatestContentByCandidate(
    candidateId: string,
  ): Promise<{ filename: string; content: Buffer } | null> {
    const row = await this.txHost.tx.query.cvDocuments.findFirst({
      where: { candidateId },
      columns: { filename: true, content: true },
      orderBy: { createdAt: 'desc' },
    });
    return row ?? null;
  }

  async findTextById(id: string): Promise<string | null> {
    const row = await this.txHost.tx.query.cvDocuments.findFirst({
      where: { id },
      columns: { text: true },
    });
    return row?.text ?? null;
  }
}
