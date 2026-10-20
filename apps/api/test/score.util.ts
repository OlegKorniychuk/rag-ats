import type { INestApplication } from '@nestjs/common';
import type { ApplicationScore, ScoreStatus } from '@rag-ats/shared';
import request from 'supertest';

const POLL_INTERVAL_MS = 200;

/**
 * Polls GET /vacancies/:id/applications until the application's
 * `score.status` equals `status`, and returns that score. Throws (with the
 * last seen status) on timeout.
 */
export async function waitForScoreStatus(
  app: INestApplication,
  cookie: string[],
  vacancyId: string,
  applicationId: string,
  status: ScoreStatus,
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
): Promise<ApplicationScore> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/applications`)
      .set('Cookie', cookie);
    if (res.status === 200) {
      const found = (
        res.body as Array<{ id: string; score: ApplicationScore }>
      ).find((a) => a.id === applicationId);
      if (found?.score.status === status) return found.score;
      last = found?.score.status ?? 'application not listed';
    } else {
      last = `HTTP ${res.status}`;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for application ${applicationId} to reach score status '${status}'; last seen: ${last}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
