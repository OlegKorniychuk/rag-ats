import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq } from 'drizzle-orm';
import type { AppTransactionAdapter } from '../db.tokens.js';
import { recruiters } from '../schema.js';
import type {
  NewRecruiter,
  Recruiter,
  RecruitersRepository,
} from './recruiters.repository.js';

@Injectable()
export class DrizzleRecruitersRepository implements RecruitersRepository {
  constructor(
    private readonly txHost: TransactionHost<AppTransactionAdapter>,
  ) {}

  // this.txHost.tx must be read fresh on every call, never cached on `this` -
  // it resolves to the current AsyncLocalStorage-backed transaction (or the
  // base db outside one), and this class is a singleton shared across requests.
  async create(data: NewRecruiter): Promise<Recruiter> {
    const [row] = await this.txHost.tx
      .insert(recruiters)
      .values(data)
      .returning();
    return row;
  }

  async findByEmail(email: string): Promise<Recruiter | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(recruiters)
      .where(eq(recruiters.email, email));
    return row ?? null;
  }

  async findById(id: string): Promise<Recruiter | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(recruiters)
      .where(eq(recruiters.id, id));
    return row ?? null;
  }
}
