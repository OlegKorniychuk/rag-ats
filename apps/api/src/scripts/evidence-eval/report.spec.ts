import { EVIDENCE_KS, type EvidenceRecallResult } from './recall.js';
import { renderEvidenceReport, type EvidenceEvalFile } from './report.js';

function file(): EvidenceEvalFile {
  const recall: EvidenceRecallResult = {
    items: 2081,
    quotes: 5250,
    quotesCv: 4848,
    quotesGithub: 402,
    rows: [...EVIDENCE_KS, 'all' as const].map((k) => ({
      k,
      quoteRecall: k === 3 ? 0.912 : 0.5,
      quoteRecallCv: 0.5,
      quoteRecallGithub: k === 1 ? null : 0.25,
      criterionAll: 0.5,
      criterionAny: 0.5,
      meanContextChars: 2431.4,
      meanChunkShare: 0.66,
    })),
  };
  return {
    label: 'small-1000',
    database: 'rag_ats_seed',
    embeddingModel: 'text-embedding-3-small',
    citationsFrom: 'baseline-units',
    at: '2026-11-22T12:00:00.000Z',
    index: {
      candidates: 100,
      chunks: { cv: 303, github: 160 },
      meanCvChunkChars: 810,
      maxCvChunkChars: 1000,
      models: ['text-embedding-3-small'],
    },
    criterionTexts: 99,
    spentUsd: 0.0001,
    recall,
  };
}

describe('renderEvidenceReport', () => {
  const md = renderEvidenceReport(file());

  it('names the run, the index and the label source', () => {
    expect(md).toContain('# Evidence recall@k: small-1000');
    expect(md).toContain('text-embedding-3-small');
    expect(md).toContain('rag_ats_seed');
    expect(md).toContain('303 CV');
    expect(md).toContain('160 GitHub');
    expect(md).toContain('baseline-units');
  });

  it('states the silver-label caveat', () => {
    expect(md).toMatch(/silver labels/i);
  });

  it('has one table row per k, with the CV/GitHub split', () => {
    const rows = md.split('\n').filter((l) => /^\| (\d+|all) \|/.test(l));
    expect(rows).toHaveLength(EVIDENCE_KS.length + 1);
    expect(md).toContain('| 3 | 91.2 %');
    expect(md).toMatch(/\| 1 \|[^\n]*\| – \|/);
    expect(md).toContain('2431');
  });
});
