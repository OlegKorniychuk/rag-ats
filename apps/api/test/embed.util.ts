import type { INestApplication } from '@nestjs/common';
import { DRIZZLE, type AppDatabase } from '../src/db/db.tokens.js';

const POLL_INTERVAL_MS = 200;

/**
 * Polls `candidates.embedded_cv_document_id` (internal, not in any API
 * response) until the candidate has been embedded, and returns the CV
 * document id its chunks belong to. Pass `cvDocumentId` to wait for one
 * specific CV (e.g. after a new upload). Throws on timeout.
 */
export async function waitForEmbedded(
  app: INestApplication,
  candidateId: string,
  {
    timeoutMs = 15_000,
    cvDocumentId,
  }: { timeoutMs?: number; cvDocumentId?: string } = {},
): Promise<string> {
  const db = app.get<AppDatabase>(DRIZZLE);
  const deadline = Date.now() + timeoutMs;
  let last: string | null | undefined;
  for (;;) {
    const row = await db.query.candidates.findFirst({
      where: { id: candidateId },
      columns: { embeddedCvDocumentId: true },
    });
    last = row?.embeddedCvDocumentId;
    if (last && (cvDocumentId === undefined || last === cvDocumentId)) {
      return last;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for candidate ${candidateId} to be embedded; embedded_cv_document_id: ${last ?? 'null'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
