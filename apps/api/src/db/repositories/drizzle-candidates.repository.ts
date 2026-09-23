import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { candidates } from '../schema.js';
import type {
  NewCandidate,
  Candidate,
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
  async create(data: NewCandidate): Promise<Candidate> {
    const [row] = await this.txHost.tx
      .insert(candidates)
      .values(data)
      .returning();
    return row;
  }

  async findByEmail(email: string): Promise<Candidate | null> {
    const row = await this.txHost.tx.query.candidates.findFirst({
      where: { email },
    });
    return row ?? null;
  }

  async update(id: string, data: Partial<NewCandidate>): Promise<Candidate> {
    const [row] = await this.txHost.tx
      .update(candidates)
      .set(data)
      .where(eq(candidates.id, id))
      .returning();
    return row;
  }
}
