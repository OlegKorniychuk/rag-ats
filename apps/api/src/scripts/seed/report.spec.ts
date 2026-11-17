import { SeedMeter } from './metering.js';
import {
  buildReport,
  renderMarkdown,
  safeDbTarget,
  type ReportInput,
} from './report.js';
import type { CandidateRow, ScoreRow } from './snapshot.js';

const candidate = (over: Partial<CandidateRow>): CandidateRow => ({
  id: 'c1',
  email: 'c1@example.com',
  parseStatus: 'parsed',
  parseError: null,
  parsedCvDocumentId: 'cv1',
  embeddedCvDocumentId: 'cv1',
  ...over,
});

const score = (over: Partial<ScoreRow>): ScoreRow => ({
  applicationId: 'a1',
  candidateId: 'c1',
  vacancyTitle: 'Backend | Engineer',
  status: 'scored',
  error: null,
  ...over,
});

function input(over: Partial<ReportInput> = {}): ReportInput {
  const meter = new SeedMeter({ inputPerMillion: 1, outputPerMillion: 4 });
  meter.recordCall('cv_profile');
  meter.recordUsage('cv_profile', {
    model: 'm',
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
  });
  return {
    label: 'smoke',
    date: new Date('2026-11-15T10:00:00Z'),
    databaseUrl: 'postgres://dbuser:s3cret@db.internal:5433/rag_ats_seed',
    scoringMode: 'full_text',
    model: 'gpt-5.4-mini',
    embeddingModel: 'text-embedding-3-small',
    pricing: { inputPerMillion: 1, outputPerMillion: 4 },
    maxUsd: 3,
    stopped: null,
    durationMs: 61_400,
    snapshot: {
      candidates: [
        candidate({ id: 'c1' }),
        candidate({
          id: 'c2',
          email: 'c2@example.com',
          parseStatus: 'failed',
          parseError: 'Could not parse the CV',
          parsedCvDocumentId: null,
          embeddedCvDocumentId: null,
        }),
      ],
      scores: [
        score({ applicationId: 'a1' }),
        score({
          applicationId: 'a2',
          status: 'failed',
          error: 'Could not score the application',
        }),
      ],
    },
    meter,
    submitErrors: [{ personaId: 'p9', vacancyId: 'ml', message: 'boom' }],
    ...over,
  };
}

describe('safeDbTarget', () => {
  it('keeps only host and database', () => {
    expect(
      safeDbTarget('postgres://u:pw@db.internal:5433/rag_ats_seed'),
    ).toEqual({ host: 'db.internal:5433', database: 'rag_ats_seed' });
  });

  it('survives an unparsable url without echoing it', () => {
    expect(safeDbTarget('not a url with secret')).toEqual({
      host: 'unknown',
      database: 'unknown',
    });
  });
});

describe('buildReport', () => {
  it('computes counts, parse success and cost', () => {
    const report = buildReport(input());
    expect(report.counts).toMatchObject({
      personas: 2,
      parsed: 1,
      failedParses: 1,
      applications: 2,
      scored: 1,
      failedScores: 1,
    });
    expect(report.parseSuccessPct).toBe(50);
    expect(report.meetsParseTarget).toBe(false);
    expect(report.durationSec).toBe(61);
    expect(report.costUsd.total).toBeCloseTo(0.003, 10);
    expect(report.failedParses[0]).toMatchObject({
      error: 'Could not parse the CV',
    });
    expect(report.stopped).toBeNull();
  });

  it('records the stop reason', () => {
    expect(buildReport(input({ stopped: 'budget' })).stopped).toBe('budget');
  });

  it('has no parse success rate without candidates', () => {
    const report = buildReport(
      input({ snapshot: { candidates: [], scores: [] } }),
    );
    expect(report.parseSuccessPct).toBeNull();
    expect(report.meetsParseTarget).toBeNull();
  });

  it('never carries database credentials', () => {
    const report = buildReport(input());
    const json = JSON.stringify(report);
    const md = renderMarkdown(report);
    for (const text of [json, md]) {
      expect(text).not.toContain('s3cret');
      expect(text).not.toContain('dbuser');
      expect(text).toContain('rag_ats_seed');
    }
  });
});

describe('renderMarkdown', () => {
  it('shows the headline numbers, failures and the pricing caveat', () => {
    const md = renderMarkdown(buildReport(input({ stopped: 'timeout' })));
    expect(md).toContain('# Seed report: smoke');
    expect(md).toContain('Scoring mode: full_text');
    expect(md).toContain('Stopped: timeout');
    expect(md).toContain('Parse success: 50.0%');
    expect(md).toContain('NOT met');
    expect(md).toContain('Failed parses');
    expect(md).toContain('Could not score the application');
    expect(md).toContain('unverified against OpenAI');
    expect(md).toContain('Submit errors');
  });

  it('escapes pipes inside table cells', () => {
    expect(renderMarkdown(buildReport(input()))).toContain(
      'Backend \\| Engineer',
    );
  });

  it('lists retried scores only when there were any', () => {
    expect(renderMarkdown(buildReport(input()))).not.toContain('retried');
    const report = buildReport({ ...input(), retriedScores: 11 });
    expect(report.retriedScores).toBe(11);
    expect(renderMarkdown(report)).toContain('- Failed scores retried: 11');
  });
});
