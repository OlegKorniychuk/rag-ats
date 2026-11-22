/**
 * Dev CLI for the RAG parameter experiments: evidence recall@k of the index in
 * `DATABASE_URL`, with a baseline run's `full_text` citations as silver labels
 * (see `evidence-eval/recall.ts`).
 *
 *   DATABASE_URL=postgres://rag_ats:rag_ats@localhost:5432/rag_ats_seed \
 *     npm run evidence-eval -w apps/api -- --label small-1000 --dry-run
 *
 * Embeds the unique criterion texts (one call) with `OPENAI_EMBEDDING_MODEL`,
 * which must be the model the index was built with. Read-only on the DB;
 * writes docs/eval/rag-params/<label>.{json,md}.
 */
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
} from '../db/repositories/candidate-chunks.repository.js';
import { LlmClient } from '../llm/llm-client.js';
import { MAX_CHUNKS_PER_CANDIDATE } from '../rag/chunking.js';
import { readScoreCache } from './eval/cache.js';
import { loadSyntheticSet } from './eval/data.js';
import { loadEvalDataset } from './eval/dataset.js';
import {
  baselinePaths,
  BASELINE_DIR,
  writeFormatted,
  writeJson,
} from './eval/layout.js';
import { PreflightError } from './eval/preflight.js';
import {
  EVIDENCE_EVAL_USAGE,
  parseEvidenceEvalArgs,
} from './evidence-eval/args.js';
import {
  citedCriteria,
  evidenceRecall,
  type RankedChunk,
} from './evidence-eval/recall.js';
import {
  EVIDENCE_EVAL_DIR,
  renderEvidenceReport,
  type EvidenceEvalFile,
  type IndexStats,
} from './evidence-eval/report.js';
import { DEFAULT_PRICING } from './parse-eval/cost.js';
import { embeddingPricePerMillion, SeedMeter } from './seed/metering.js';
import { fromRoot, loadEnv, UsageError } from './shared/cli.js';

async function readIndexStats(pool: Pool): Promise<IndexStats> {
  const { rows } = await pool.query<{
    source: 'cv' | 'github';
    chunks: string;
    mean_chars: string | null;
    max_chars: number | null;
  }>(
    `select source, count(*) as chunks, avg(length(text)) as mean_chars, max(length(text)) as max_chars
       from candidate_chunks group by source`,
  );
  const meta = await pool.query<{ candidates: string; models: string[] }>(
    `select count(distinct candidate_id) as candidates,
            coalesce(array_agg(distinct model), '{}') as models
       from candidate_chunks`,
  );
  const cv = rows.find((r) => r.source === 'cv');
  const github = rows.find((r) => r.source === 'github');
  return {
    candidates: Number(meta.rows[0].candidates),
    chunks: {
      cv: Number(cv?.chunks ?? 0),
      github: Number(github?.chunks ?? 0),
    },
    meanCvChunkChars: Math.round(Number(cv?.mean_chars ?? 0)),
    maxCvChunkChars: cv?.max_chars ?? 0,
    models: meta.rows[0].models.filter((m) => m !== null),
  };
}

const databaseName = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
  } catch {
    return '?';
  }
};

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(EVIDENCE_EVAL_USAGE);
    return 0;
  }
  const args = parseEvidenceEvalArgs(argv);

  const scoresPath = fromRoot(
    baselinePaths(BASELINE_DIR, args.citationsFrom).scores,
  );
  const cache = await readScoreCache(scoresPath);
  const items = citedCriteria(cache.byKey.values());
  if (items.length === 0) {
    throw new UsageError(`no full_text citations in ${scoresPath}`);
  }
  const texts = [...new Set(items.map((i) => i.text))];

  const env = loadEnv();
  const model = env.OPENAI_EMBEDDING_MODEL;
  const pricePerMillion = embeddingPricePerMillion(model);
  const estimateUsd =
    (Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4) * pricePerMillion) /
    1_000_000;

  const set = await loadSyntheticSet();
  Logger.overrideLogger(['warn', 'error']);
  const meter = new SeedMeter(DEFAULT_PRICING);
  const { createEvalContext } = await import('./eval/app.js');
  const app = await createEvalContext({ env, meter });
  try {
    let dataset;
    try {
      dataset = await loadEvalDataset(app, set);
    } catch (err) {
      if (err instanceof PreflightError) {
        console.error(err.message);
        return 1;
      }
      throw err;
    }
    const index = await readIndexStats(app.get(Pool));
    const database = databaseName(env.DATABASE_URL);
    const quotes = items.reduce((n, i) => n + i.quotes.length, 0);
    console.log(
      [
        `Database ${database}: ${index.candidates} candidates, ${index.chunks.cv} CV + ${index.chunks.github} GitHub chunks, embedded with ${index.models.join(', ') || 'nothing'}`,
        `Labels from ${args.citationsFrom}: ${items.length} criteria, ${quotes} quotes, ${texts.length} criterion texts to embed with ${model}`,
        `Estimate: $${estimateUsd.toFixed(4)}; cap $${args.maxUsd.toFixed(2)}`,
      ].join('\n'),
    );
    if (!index.models.every((m) => m === model)) {
      console.error(
        `The index was embedded with ${index.models.join(', ')}, not ${model}; set OPENAI_EMBEDDING_MODEL`,
      );
      return 1;
    }
    if (args.dryRun) {
      console.log('Dry run: no LLM calls, nothing written.');
      return 0;
    }
    if (estimateUsd > args.maxUsd) {
      console.error('The estimate exceeds --max-usd; nothing run');
      return 1;
    }

    const { vectors } = await app.get(LlmClient).embed(texts);
    const vectorOf = new Map(texts.map((text, i) => [text, vectors[i]]));
    const chunks = app.get<CandidateChunksRepository>(
      CANDIDATE_CHUNKS_REPOSITORY,
    );
    // One ranking per candidate and criterion text (the same pair recurs
    // across vacancies only if the text does).
    const rankings = new Map<string, RankedChunk[]>();
    const rankingKey = (candidateId: string, text: string) =>
      `${candidateId}\u0000${text}`;
    for (const item of items) {
      const candidateId = dataset.candidateIdByPersonaId.get(item.personaId);
      if (!candidateId) {
        throw new Error(`No seeded candidate for persona ${item.personaId}`);
      }
      const key = rankingKey(candidateId, item.text);
      if (rankings.has(key)) continue;
      const hits = await chunks.findNearest(
        vectorOf.get(item.text)!,
        MAX_CHUNKS_PER_CANDIDATE,
        { candidateId },
      );
      rankings.set(
        key,
        hits.map((hit) => ({ source: hit.source, text: hit.text })),
      );
    }
    const recall = evidenceRecall(items, (item) =>
      rankings.get(
        rankingKey(
          dataset.candidateIdByPersonaId.get(item.personaId)!,
          item.text,
        ),
      )!,
    );

    const label = args.label!;
    const file: EvidenceEvalFile = {
      label,
      database,
      embeddingModel: model,
      citationsFrom: args.citationsFrom,
      at: new Date().toISOString(),
      index,
      criterionTexts: texts.length,
      spentUsd: meter.spentUsd,
      recall,
    };
    const dir = fromRoot(EVIDENCE_EVAL_DIR);
    const jsonPath = join(dir, `${label}.json`);
    const mdPath = join(dir, `${label}.md`);
    await writeJson(jsonPath, file);
    await writeFormatted(mdPath, renderEvidenceReport(file), 'markdown');
    const at3 = recall.rows.find((r) => r.k === 3);
    console.log(
      `Quote recall@3 ${((at3?.quoteRecall ?? 0) * 100).toFixed(1)} %; spent $${meter.spentUsd.toFixed(4)}\nWrote ${jsonPath}\nWrote ${mdPath}`,
    );
    return 0;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
