import type { INestApplication } from '@nestjs/common';
import type { ParseStatus } from '@rag-ats/shared';
import request from 'supertest';

const POLL_INTERVAL_MS = 200;

export interface ParsedCandidateBody {
  id: string;
  parseStatus: ParseStatus;
  parseError: string | null;
  skills: string[];
  experience: string;
  projects: string[];
  summary: string;
  [key: string]: unknown;
}

/**
 * Polls GET /candidates/:id until `parseStatus` equals `status`, and returns
 * that candidate body. Throws (with the last seen status) on timeout.
 */
export async function waitForParseStatus(
  app: INestApplication,
  cookie: string[],
  candidateId: string,
  status: ParseStatus,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<ParsedCandidateBody> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/candidates/${candidateId}`)
      .set('Cookie', cookie);
    if (res.status === 200) {
      const body = res.body as ParsedCandidateBody;
      if (body.parseStatus === status) return body;
      last = body.parseStatus;
    } else {
      last = `HTTP ${res.status}`;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for candidate ${candidateId} to reach parseStatus '${status}'; last seen: ${last}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
