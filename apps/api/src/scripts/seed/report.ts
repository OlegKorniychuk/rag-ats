import type { ScoringMode } from '@rag-ats/shared';
import { PRICING_CAVEAT, type Pricing } from '../parse-eval/cost.js';
import type { SeedMeter } from './metering.js';
import {
  summarize,
  type SeedSnapshot,
  type SnapshotCounts,
} from './snapshot.js';

/** The SPEC's CV-parse success criterion. */
export const PARSE_SUCCESS_TARGET_PCT = 90;

export type StopReason = 'budget' | 'timeout' | null;

export interface SubmitError {
  personaId: string;
  vacancyId: string;
  message: string;
}

export interface SeedReport {
  label: string;
  date: string;
  db: { host: string; database: string };
  scoringMode: ScoringMode;
  model: string;
  embeddingModel: string;
  pricing: Pricing;
  pricingCaveat: string;
  maxUsd: number;
  stopped: StopReason;
  durationSec: number;
  /** Failed scores re-queued by `--retry-failed` in this run. */
  retriedScores: number;
  counts: SnapshotCounts & { personas: number };
  parseSuccessPct: number | null;
  parseSuccessTarget: number;
  meetsParseTarget: boolean | null;
  tokens: {
    chatCalls: number;
    chatInput: number;
    chatOutput: number;
    embeddingCalls: number;
    embeddingTokens: number;
    callsBySchema: Record<
      string,
      { calls: number; inputTokens: number; outputTokens: number }
    >;
  };
  costUsd: { chat: number; embedding: number; total: number };
  submitErrors: SubmitError[];
  failedParses: Array<{
    candidateId: string;
    email: string;
    error: string | null;
  }>;
  failedScores: Array<{
    applicationId: string;
    candidateId: string;
    vacancy: string;
    error: string | null;
  }>;
}

/**
 * Host and database name only. The username and password of the URL must never
 * reach a report (it is committed to the repo).
 */
export function safeDbTarget(databaseUrl: string): {
  host: string;
  database: string;
} {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.host || 'unknown',
      database:
        decodeURIComponent(url.pathname.replace(/^\//, '')) || 'unknown',
    };
  } catch {
    return { host: 'unknown', database: 'unknown' };
  }
}

export interface ReportInput {
  label: string;
  date: Date;
  databaseUrl: string;
  scoringMode: ScoringMode;
  model: string;
  embeddingModel: string;
  pricing: Pricing;
  maxUsd: number;
  stopped: StopReason;
  durationMs: number;
  retriedScores?: number;
  snapshot: SeedSnapshot;
  meter: SeedMeter;
  submitErrors: SubmitError[];
}

export function buildReport(input: ReportInput): SeedReport {
  const counts = summarize(input.snapshot);
  const { meter } = input;
  const tokens = meter.chatTokens;
  const total = counts.candidates;
  const parseSuccessPct = total === 0 ? null : (counts.parsed / total) * 100;
  return {
    label: input.label,
    date: input.date.toISOString(),
    db: safeDbTarget(input.databaseUrl),
    scoringMode: input.scoringMode,
    model: input.model,
    embeddingModel: input.embeddingModel,
    pricing: input.pricing,
    pricingCaveat: PRICING_CAVEAT,
    maxUsd: input.maxUsd,
    stopped: input.stopped,
    durationSec: Math.round(input.durationMs / 1000),
    retriedScores: input.retriedScores ?? 0,
    counts: { ...counts, personas: counts.candidates },
    parseSuccessPct,
    parseSuccessTarget: PARSE_SUCCESS_TARGET_PCT,
    meetsParseTarget:
      parseSuccessPct === null
        ? null
        : parseSuccessPct >= PARSE_SUCCESS_TARGET_PCT,
    tokens: {
      chatCalls: meter.chatCalls,
      chatInput: tokens.inputTokens,
      chatOutput: tokens.outputTokens,
      embeddingCalls: meter.embeddingCallCount,
      embeddingTokens: meter.embeddingTokens,
      callsBySchema: meter.snapshot(),
    },
    costUsd: {
      chat: meter.chatCostUsd,
      embedding: meter.embeddingCostUsd,
      total: meter.spentUsd,
    },
    submitErrors: input.submitErrors,
    failedParses: input.snapshot.candidates
      .filter((c) => c.parseStatus === 'failed')
      .map((c) => ({
        candidateId: c.id,
        email: c.email,
        error: c.parseError,
      })),
    failedScores: input.snapshot.scores
      .filter((s) => s.status === 'failed')
      .map((s) => ({
        applicationId: s.applicationId,
        candidateId: s.candidateId,
        vacancy: s.vacancyTitle,
        error: s.error,
      })),
  };
}

const usd = (value: number): string => `$${value.toFixed(4)}`;
const pct = (value: number | null): string =>
  value === null ? 'n/a' : `${value.toFixed(1)}%`;
const cell = (value: string | null): string =>
  (value ?? '').replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ');

export function renderMarkdown(report: SeedReport): string {
  const c = report.counts;
  const lines: string[] = [
    `# Seed report: ${report.label}`,
    '',
    `- Date: ${report.date}`,
    `- Database: ${report.db.database} on ${report.db.host}`,
    `- Scoring mode: ${report.scoringMode}`,
    `- Model: ${report.model} (embeddings: ${report.embeddingModel})`,
    `- Duration: ${report.durationSec}s`,
    `- Stopped: ${report.stopped ?? 'no (ran to completion)'}`,
    ...(report.retriedScores > 0
      ? [`- Failed scores retried: ${report.retriedScores}`]
      : []),
    `- Cap: ${usd(report.maxUsd)}`,
    '',
    '## Result',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Personas (candidates) | ${c.personas} |`,
    `| Parsed | ${c.parsed} |`,
    `| Parse failed | ${c.failedParses} |`,
    `| Parse not finished | ${c.parsePending} |`,
    `| Embedded | ${c.embedded} |`,
    `| Applications | ${c.applications} |`,
    `| Scored | ${c.scored} |`,
    `| Score failed | ${c.failedScores} |`,
    `| Score pending | ${c.scoresPending} |`,
    '',
    `Parse success: ${pct(report.parseSuccessPct)} against the SPEC criterion of at least ${report.parseSuccessTarget}% (${
      report.meetsParseTarget === null
        ? 'n/a'
        : report.meetsParseTarget
          ? 'met'
          : 'NOT met'
    }).`,
    '',
    '## Tokens and cost',
    '',
    `- Chat: ${report.tokens.chatCalls} calls, ${report.tokens.chatInput} input / ${report.tokens.chatOutput} output tokens, ${usd(report.costUsd.chat)}`,
    `- Embeddings: ${report.tokens.embeddingCalls} calls, ${report.tokens.embeddingTokens} tokens, ${usd(report.costUsd.embedding)}`,
    `- Total: ${usd(report.costUsd.total)}`,
    `- Pricing: ${report.pricing.inputPerMillion} / ${report.pricing.outputPerMillion} USD per 1M input / output tokens. ${report.pricingCaveat}`,
    '',
    '| Call (schema) | Calls | Input tokens | Output tokens |',
    '| --- | ---: | ---: | ---: |',
    ...Object.entries(report.tokens.callsBySchema).map(
      ([name, u]) =>
        `| ${cell(name)} | ${u.calls} | ${u.inputTokens} | ${u.outputTokens} |`,
    ),
  ];

  if (report.submitErrors.length > 0) {
    lines.push(
      '',
      '## Submit errors',
      '',
      '| Persona | Vacancy | Error |',
      '| --- | --- | --- |',
    );
    for (const e of report.submitErrors) {
      lines.push(
        `| ${cell(e.personaId)} | ${cell(e.vacancyId)} | ${cell(e.message)} |`,
      );
    }
  }
  if (report.failedParses.length > 0) {
    lines.push(
      '',
      '## Failed parses',
      '',
      '| Candidate | Email | Error |',
      '| --- | --- | --- |',
    );
    for (const f of report.failedParses) {
      lines.push(`| ${f.candidateId} | ${cell(f.email)} | ${cell(f.error)} |`);
    }
  }
  if (report.failedScores.length > 0) {
    lines.push(
      '',
      '## Failed scores',
      '',
      '| Application | Candidate | Vacancy | Error |',
      '| --- | --- | --- | --- |',
    );
    for (const f of report.failedScores) {
      lines.push(
        `| ${f.applicationId} | ${f.candidateId} | ${cell(f.vacancy)} | ${cell(f.error)} |`,
      );
    }
  }
  return lines.join('\n') + '\n';
}
