/**
 * Dev CLI for the RAG parameter experiments: rebuilds `candidate_chunks` of an
 * experiment copy of the seeded database with another CV chunk size and/or
 * embedding model.
 *
 *   docker exec rag-ats-db-1 createdb -U rag_ats -T rag_ats_seed rag_ats_exp_large_500
 *   DATABASE_URL=postgres://rag_ats:rag_ats@localhost:5432/rag_ats_exp_large_500 \
 *   OPENAI_EMBEDDING_MODEL=text-embedding-3-large \
 *     npm run reindex -w apps/api -- --chunk-max-chars 500 --dry-run
 *
 * It refuses any database not named `rag_ats_exp_*`. Only chunks change: the
 * CV document is the same, so the candidate's embed marker stays valid.
 */
import { Logger } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
} from '../db/repositories/candidate-chunks.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../db/repositories/cv-documents.repository.js';
import { LlmClient } from '../llm/llm-client.js';
import { DEFAULT_PRICING } from './parse-eval/cost.js';
import {
  assertExperimentDb,
  parseReindexArgs,
  REINDEX_USAGE,
} from './reindex/args.js';
import { reindexAll, type ReindexSummary } from './reindex/reindex.js';
import { embeddingPricePerMillion, SeedMeter } from './seed/metering.js';
import { loadEnv, UsageError } from './shared/cli.js';

function summaryLines(
  summary: ReindexSummary,
  header: string,
  pricePerMillion: number,
  maxUsd: number,
): string[] {
  return [
    header,
    `Candidates: ${summary.candidates} re-chunked, ${summary.skipped} skipped (not parsed)`,
    `Chunks: ${summary.chunks.cv} CV (mean ${summary.meanCvChunkChars}, max ${summary.maxCvChunkChars} chars), ${summary.chunks.github} GitHub`,
    `Estimate: ${summary.estimatedTokens} tokens, $${summary.estimatedUsd.toFixed(4)} at $${pricePerMillion}/1M; cap $${maxUsd.toFixed(2)}`,
  ];
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(REINDEX_USAGE);
    return 0;
  }
  const args = parseReindexArgs(argv);
  const env = loadEnv();
  // Before any connection: never touch the dev or the seeded database.
  const db = assertExperimentDb(env.DATABASE_URL);
  const model = env.OPENAI_EMBEDDING_MODEL;
  const pricePerMillion = embeddingPricePerMillion(model);

  Logger.overrideLogger(['warn', 'error']);
  const meter = new SeedMeter(DEFAULT_PRICING);
  const { createEvalContext } = await import('./eval/app.js');
  const app = await createEvalContext({ env, meter });
  try {
    const candidates = app.get<CandidatesRepository>(CANDIDATES_REPOSITORY);
    const cvDocuments = app.get<CvDocumentsRepository>(CV_DOCUMENTS_REPOSITORY);
    const chunks = app.get<CandidateChunksRepository>(
      CANDIDATE_CHUNKS_REPOSITORY,
    );
    const llm = app.get(LlmClient);
    const cls = app.get(ClsService);
    const txHost = app.get(TransactionHost);
    const inCls = <T>(fn: () => Promise<T>): Promise<T> => cls.run(fn);

    const summary = await reindexAll(
      {
        candidateIds: () =>
          inCls(async () => (await candidates.findAll()).map((c) => c.id)),
        embedState: (id) => inCls(() => candidates.findEmbedState(id)),
        cvText: (id) => inCls(() => cvDocuments.findTextById(id)),
        snapshot: (id) => inCls(() => candidates.findGithubSnapshot(id)),
        embed: async (texts) => (await llm.embed(texts)).vectors,
        save: (candidateId, cvDocumentId, newChunks) =>
          inCls(() =>
            txHost.withTransaction(() =>
              chunks.replaceForCandidate(
                candidateId,
                cvDocumentId,
                newChunks,
                llm.embeddingModel,
              ),
            ),
          ),
        spentUsd: () => meter.spentUsd,
      },
      { ...args, pricePerMillion },
    );

    const header = `Database ${db}, model ${model}, CV chunk max ${args.cvMaxChars} chars${
      args.dryRun ? ' (dry run: no LLM calls, nothing written)' : ''
    }`;
    const lines = summaryLines(summary, header, pricePerMillion, args.maxUsd);
    if (!args.dryRun) {
      lines.push(
        `Spent: ${meter.embeddingTokens} tokens, $${meter.embeddingCostUsd.toFixed(4)} (${meter.embeddingCallCount} calls)`,
      );
    }
    console.log(lines.join('\n'));
    if (summary.stopped === 'budget') {
      console.error('Stopped on the budget cap; the index is incomplete');
      return 1;
    }
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
