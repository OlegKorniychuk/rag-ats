import type { ParseStatus } from '@rag-ats/shared';

export const PARSE_POLL_INTERVAL_MS = 3000;

export const isParseInFlight = (status: ParseStatus): boolean =>
  status === 'pending' || status === 'parsing';

export const hasParseInFlight = (
  candidates: readonly { parseStatus: ParseStatus }[] | undefined,
): boolean =>
  candidates?.some((candidate) => isParseInFlight(candidate.parseStatus)) ??
  false;
