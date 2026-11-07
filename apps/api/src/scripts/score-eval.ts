/**
 * Live scoring eval (Checkpoint B). Reuses the production CV text extractor,
 * GitHub fetcher, criteria extractor and application scorer with no DB, server
 * or queue, over the vacancies in `data/checkpoint-b/vacancies.json` and the
 * Checkpoint A CVs.
 *
 *   npm run score-eval -w apps/api -- --label baseline --runs 2 --write-review
 *   npm run score-eval -w apps/api -- --label t --only backend-java:*,data-ml:03-data-ml
 *   npm run score-eval -w apps/api -- --dry-run
 *   npm run score-eval -w apps/api -- --label rag-1 --mode rag --k 3 --write-review
 *   npm run score-eval -w apps/api -- --summarise-review docs/eval/checkpoint-b/baseline.review.md --sample 20 --seed 7
 *
 * Real OpenAI calls are made unless --dry-run (or a review-only command) is
 * given. `--mode rag` scores each criterion from its k nearest CV/GitHub
 * chunks (chunked and embedded in memory, no DB) instead of the whole CV; its
 * embedding tokens are costed at --embedding-price (USD per 1M). The API key is
 * never printed. Relative paths resolve from the repo
 * root.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Logger } from '@nestjs/common';
import { CvTextExtractor, isPdf } from '../cv/cv-text-extractor.js';
import { GithubClient } from '../github/github-client.js';
import { GithubProfileFetcher } from '../github/github-profile-fetcher.js';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import {
  CriteriaExtractor,
  type VacancyCriterion,
} from '../llm/criteria-extractor.js';
import { ApplicationScorer } from '../llm/application-scorer.js';
import { LlmClient } from '../llm/llm-client.js';
import { ragGroundingSources } from '../llm/prompts/application-score-rag.prompt.js';
import { chunkCandidate, type TextChunk } from '../rag/chunking.js';
import {
  costUsd,
  DEFAULT_PRICING,
  PRICING_CAVEAT,
  type Pricing,
} from './parse-eval/cost.js';
import { loadManifest } from './parse-eval/manifest.js';
import {
  bandOf,
  bandResult,
  checkCoverage,
  checkGrounded,
  findFillerSuspects,
  scorerSources,
} from './score-eval/checks.js';
import { countRequirements } from './score-eval/dry-run.js';
import { UsageMeter } from './score-eval/meter.js';
import { OnlyError, parseOnly } from './score-eval/only.js';
import {
  buildEvalChunks,
  DEFAULT_EMBEDDING_PRICE,
  DEFAULT_RAG_K,
  embeddingCostUsd,
  estimateEmbedding,
  evidenceCoverage,
  ModeError,
  parseMode,
  retrieveForCriteria,
  toEvidence,
  type CriterionRetrieval,
  type EvalChunk,
} from './score-eval/rag.js';
import { computeTotals, renderMarkdown } from './score-eval/report.js';
import type {
  CvInfo,
  EvalResult,
  ExtractionResult,
  PairResult,
} from './score-eval/result.js';
import {
  buildReviewRows,
  parseReview,
  renderReviewStub,
  renderReviewSummary,
  renderSample,
  ReviewError,
  sampleRows,
  summariseReview,
} from './score-eval/review.js';
import { loadVacancySet, type EvalVacancy } from './score-eval/vacancies.js';
import { fromRoot, loadEnv, parseNumber, UsageError } from './shared/cli.js';
import { fetchGithub } from './shared/github.js';

interface CvData {
  text: string;
  github: GithubSnapshot | null;
  /** `rag` mode: the CV's embedded chunks; null in full text. */
  chunks: EvalChunk[] | null;
}

interface EmbeddedCv {
  chunks: EvalChunk[];
  tokens: number;
  costUsd: number;
}

const errorText = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

/** Review-only commands: no env, no network, no LLM. */
async function reviewCommand(
  file: string,
  summarise: boolean,
  sample: number | undefined,
  seed: number,
): Promise<void> {
  const path = fromRoot(file);
  let rows;
  try {
    rows = parseReview(await readFile(path, 'utf8'));
  } catch (err) {
    if (err instanceof ReviewError) throw new UsageError(err.message);
    throw new UsageError(`cannot read review file ${path}`);
  }

  if (summarise) {
    const summary = renderReviewSummary(summariseReview(rows));
    console.log(summary);
    const out = path.replace(/\.md$/, '') + '.summary.md';
    await writeFile(out, summary + '\n');
    console.log(`\nWrote ${out}`);
  }
  if (sample !== undefined) {
    const picked = sampleRows(rows, sample, seed);
    console.log(`\n${renderSample(picked, sample, seed)}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      label: { type: 'string' },
      runs: { type: 'string' },
      manifest: { type: 'string' },
      vacancies: { type: 'string' },
      'out-dir': { type: 'string' },
      only: { type: 'string' },
      'input-price': { type: 'string' },
      'output-price': { type: 'string' },
      mode: { type: 'string' },
      k: { type: 'string' },
      'embedding-price': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'write-review': { type: 'boolean', default: false },
      'summarise-review': { type: 'string' },
      'review-file': { type: 'string' },
      sample: { type: 'string' },
      seed: { type: 'string' },
    },
    strict: true,
  });

  const dryRun = values['dry-run'] ?? false;
  const sample =
    values.sample === undefined
      ? undefined
      : parseNumber('sample', values.sample, 0, true);
  const seed = parseNumber('seed', values.seed, 1, true);

  // Review-only commands.
  if (values['summarise-review'] !== undefined) {
    return reviewCommand(values['summarise-review'], true, sample, seed);
  }
  if (sample !== undefined) {
    if (values['review-file'] === undefined) {
      throw new UsageError(
        '--sample needs --summarise-review <file> or --review-file <file>',
      );
    }
    return reviewCommand(values['review-file'], false, sample, seed);
  }

  let mode;
  try {
    mode = parseMode(values.mode);
  } catch (err) {
    if (err instanceof ModeError) throw new UsageError(err.message);
    throw err;
  }
  const k = parseNumber('k', values.k, DEFAULT_RAG_K, true);
  const embeddingPrice = parseNumber(
    'embedding-price',
    values['embedding-price'],
    DEFAULT_EMBEDDING_PRICE,
  );

  const label = values.label;
  if (!dryRun) {
    if (!label) throw new UsageError('--label <name> is required');
    if (!/^[A-Za-z0-9._-]+$/.test(label)) {
      throw new UsageError('--label may only contain letters, digits, . _ -');
    }
  }
  const runs = parseNumber('runs', values.runs, 1, true);
  const pricing: Pricing = {
    inputPerMillion: parseNumber(
      'input-price',
      values['input-price'],
      DEFAULT_PRICING.inputPerMillion,
    ),
    outputPerMillion: parseNumber(
      'output-price',
      values['output-price'],
      DEFAULT_PRICING.outputPerMillion,
    ),
  };
  const manifestPath = fromRoot(
    values.manifest ?? 'data/checkpoint-a/manifest.json',
  );
  const vacanciesPath = fromRoot(
    values.vacancies ?? 'data/checkpoint-b/vacancies.json',
  );
  const outDir = fromRoot(values['out-dir'] ?? 'docs/eval/checkpoint-b');

  const manifest = await loadManifest(manifestPath);
  const vacancySet = await loadVacancySet(
    vacanciesPath,
    manifest.cvs.map((cv) => cv.id),
  );
  let selector;
  try {
    selector = parseOnly(
      values.only,
      vacancySet.vacancies.map((v) => v.id),
      manifest.cvs.map((cv) => cv.id),
    );
  } catch (err) {
    if (err instanceof OnlyError) throw new UsageError(err.message);
    throw err;
  }

  // Only what the selected pairs need.
  const vacancies = vacancySet.vacancies.filter((v) =>
    manifest.cvs.some((cv) => selector.has(v.id, cv.id)),
  );
  const cvs = manifest.cvs.filter((cv) =>
    vacancies.some((v) => selector.has(v.id, cv.id)),
  );
  const pairCount = vacancies.reduce(
    (n, v) => n + cvs.filter((cv) => selector.has(v.id, cv.id)).length,
    0,
  );

  const env = loadEnv();
  // Keep the console to this script's own output plus warnings.
  Logger.overrideLogger(['warn', 'error']);

  const textExtractor = new CvTextExtractor();
  const fetcher = new GithubProfileFetcher(new GithubClient(env));

  // Only built for live runs, so a dry run can never reach OpenAI.
  let criteriaExtractor: CriteriaExtractor | null = null;
  let scorer: ApplicationScorer | null = null;
  let llm: LlmClient | null = null;
  const meter = new UsageMeter();
  if (!dryRun) {
    llm = new LlmClient(env);
    const original = llm.parseStructured.bind(llm);
    const originalEmbed = llm.embed.bind(llm);
    llm.embed = async (texts) => {
      const result = await originalEmbed(texts);
      meter.recordEmbedding(result.usage);
      return result;
    };
    llm.parseStructured = (async (params: Parameters<typeof original>[0]) => {
      meter.recordCall();
      const result = await original(params);
      meter.recordUsage(result.usage);
      return result;
    }) as typeof llm.parseStructured;
    criteriaExtractor = new CriteriaExtractor(llm);
    scorer = new ApplicationScorer(llm);
  }

  const ragNote =
    mode === 'rag'
      ? `, mode rag (k ${k}, embeddings ${env.OPENAI_EMBEDDING_MODEL})`
      : '';
  console.log(
    dryRun
      ? `Dry run: ${cvs.length} CV(s), ${vacancies.length} vacancy(ies)${ragNote}, no LLM calls`
      : `Eval "${label}": ${pairCount} pair(s) x ${runs} run(s), model ${env.OPENAI_MODEL}${ragNote}`,
  );

  // CV text once per CV, GitHub snapshot once per CV, per invocation.
  const cvInfos: CvInfo[] = [];
  const cvData = new Map<string, CvData>();
  const dryChunkTexts: string[][] = [];
  for (const cv of cvs) {
    const info: CvInfo = {
      id: cv.id,
      file: cv.file,
      githubUrl: cv.githubUrl,
      githubStatus: 'none',
      textLength: null,
      error: null,
    };
    cvInfos.push(info);
    try {
      const buffer = await readFile(resolve(dirname(manifestPath), cv.file));
      if (!isPdf(buffer)) throw new Error('not a PDF');
      const text = await textExtractor.extract(buffer);
      info.textLength = text.length;
      const github = await fetchGithub(fetcher, cv.githubUrl);
      info.githubStatus = github.status;
      let embedded: EmbeddedCv | null = null;
      let chunkNote = '';
      if (mode === 'rag') {
        const textChunks = chunkCandidate(text, github.snapshot);
        info.chunkCount = textChunks.length;
        if (dryRun || !llm) {
          dryChunkTexts.push(textChunks.map((c) => c.text));
          chunkNote = `, ${textChunks.length} chunk(s)`;
        } else {
          embedded = await embedChunks(llm, meter, textChunks, embeddingPrice);
          info.embeddingTokens = embedded.tokens;
          info.embeddingCostUsd = embedded.costUsd;
          console.log(
            `${cv.id}: ${textChunks.length} chunk(s), ${embedded.tokens} embedding tokens`,
          );
        }
      }
      cvData.set(cv.id, {
        text,
        github: github.snapshot,
        chunks: embedded?.chunks ?? null,
      });
      if (dryRun) {
        console.log(
          `${cv.id}: text ${text.length} chars, GitHub ${github.status}${chunkNote}`,
        );
      }
    } catch (err) {
      info.error = `extraction failed: ${err instanceof Error ? err.message : String(err)}`;
      console.log(`${cv.id}: ${info.error}`);
    }
  }

  if (dryRun || !criteriaExtractor || !scorer) {
    for (const v of vacancies) {
      const selected = cvs.filter((cv) => selector.has(v.id, cv.id)).length;
      console.log(
        `${v.id}: ${countRequirements(v.requirements)} requirement bullet(s), ${selected} CV(s) selected, ${Object.keys(v.expect).length} expectation(s), ${v.mustCoverTerms?.length ?? 0} must-cover term(s)`,
      );
    }
    if (mode === 'rag') {
      const estimate = estimateEmbedding({
        chunkTexts: dryChunkTexts,
        requirementTexts: vacancies.map((v) => v.requirements),
        runs,
        pricePerMillion: embeddingPrice,
      });
      console.log(
        `Embedding estimate (~4 chars/token): ${estimate.chunkTokens} tokens for the CV chunks + ${estimate.criteriaTokens} for the criteria over ${runs} run(s) = ${estimate.totalTokens} tokens, ~$${estimate.costUsd.toFixed(4)} at $${embeddingPrice} per 1M. Chat cost is not estimated.`,
      );
    }
    return;
  }

  const extractions: ExtractionResult[] = [];
  const pairs: PairResult[] = [];

  for (let run = 1; run <= runs; run++) {
    for (const vacancy of vacancies) {
      const extraction = await extractCriteria(
        criteriaExtractor,
        meter,
        vacancy,
        run,
        pricing,
      );
      extractions.push(extraction);
      const criteriaVectors =
        mode === 'rag' && llm && extraction.error === null
          ? await embedCriteria(llm, meter, extraction, embeddingPrice)
          : null;

      for (const cv of cvs) {
        if (!selector.has(vacancy.id, cv.id)) continue;
        const data = cvData.get(cv.id);
        const pair = await scorePair({
          scorer,
          meter,
          vacancy,
          cvId: cv.id,
          run,
          pricing,
          criteria: extraction.error === null ? extraction.criteria : null,
          rag:
            mode === 'rag'
              ? {
                  k,
                  vectors: criteriaVectors,
                  error: extraction.embeddingError ?? null,
                }
              : null,
          data: data ?? null,
          cvError: cvInfos.find((i) => i.id === cv.id)?.error ?? null,
          extractionError: extraction.error,
        });
        pairs.push(pair);
        const tokens = pair.usage
          ? `${pair.usage.inputTokens} in / ${pair.usage.outputTokens} out`
          : 'no usage';
        const coverage = pair.evidenceCoverage
          ? `, evidence ${pair.evidenceCoverage.shown}/${pair.evidenceCoverage.total} chunks`
          : '';
        console.log(
          `${vacancy.id} x ${cv.id} run ${run}: ${
            pair.status === 'failed'
              ? `FAILED (${pair.error})`
              : `overall ${pair.overall} (${pair.band}), band ${pair.bandResult}, grounded ${pair.grounded?.ok ? 'yes' : 'NO'}`
          }, ${pair.attempts} attempt(s), ${tokens}${coverage}, $${pair.costUsd.toFixed(4)}`,
        );
      }
    }
  }

  const evalResult: EvalResult = {
    label: label!,
    model: env.OPENAI_MODEL,
    date: new Date().toISOString(),
    runs,
    pricing,
    mode,
    ...(mode === 'rag' && {
      k,
      embeddingModel: env.OPENAI_EMBEDDING_MODEL,
      embeddingPrice,
    }),
    cvs: cvInfos,
    vacancies: vacancies.map((v) => ({
      id: v.id,
      title: v.title,
      requirementCount: countRequirements(v.requirements),
    })),
    extractions,
    pairs,
  };
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, `${label}.json`);
  const mdPath = join(outDir, `${label}.md`);
  await writeFile(jsonPath, JSON.stringify(evalResult, null, 2) + '\n');
  await writeFile(mdPath, renderMarkdown(evalResult));
  const written = [jsonPath, mdPath];

  if (values['write-review']) {
    const reviewPath = join(outDir, `${label}.review.md`);
    const rows = buildReviewRows(pairs);
    await writeFile(reviewPath, renderReviewStub(label!, rows));
    written.push(reviewPath);
    console.log(`Review stub: ${rows.length} citation row(s)`);
  }

  const t = computeTotals(evalResult);
  console.log(
    `\nPairs ${t.pairs} (${t.failed} failed, ${t.retried} retried), grounded ${t.grounded}/${t.scored}, band ${t.bandMatches}/${t.bandExpected}, cost $${t.totalCost.toFixed(4)}${mode === 'rag' ? ` (embeddings ${t.embeddingTokens} tokens, $${t.embeddingCost.toFixed(4)})` : ''}.`,
  );
  console.log(PRICING_CAVEAT);
  for (const path of written) console.log(`Wrote ${path}`);
}

async function extractCriteria(
  extractor: CriteriaExtractor,
  meter: UsageMeter,
  vacancy: EvalVacancy,
  run: number,
  pricing: Pricing,
): Promise<ExtractionResult> {
  meter.reset();
  let criteria: VacancyCriterion[] = [];
  let error: string | null = null;
  try {
    criteria = (await extractor.extract(vacancy.title, vacancy.requirements))
      .criteria;
  } catch (err) {
    error = errorText(err);
  }
  const usage = meter.usage;
  const result: ExtractionResult = {
    vacancyId: vacancy.id,
    run,
    error,
    criteria,
    usage,
    costUsd: costUsd(usage, pricing),
    coverage:
      vacancy.mustCoverTerms && error === null
        ? checkCoverage(
            vacancy.mustCoverTerms,
            criteria.map((c) => c.text),
          )
        : null,
  };
  console.log(
    `${vacancy.id} run ${run}: ${error ? `extraction FAILED (${error})` : `${criteria.length} criteria${result.coverage ? `, coverage ${result.coverage.covered.length}/${vacancy.mustCoverTerms!.length}` : ''}`}, $${result.costUsd.toFixed(4)}`,
  );
  return result;
}

/** Chunk embeddings for one CV (once per invocation), counted by the meter. */
async function embedChunks(
  llm: LlmClient,
  meter: UsageMeter,
  textChunks: TextChunk[],
  pricePerMillion: number,
): Promise<EmbeddedCv> {
  meter.reset();
  let vectors: number[][];
  try {
    vectors = (await llm.embed(textChunks.map((c) => c.text))).vectors;
  } catch (err) {
    throw new Error(`chunk embedding failed (${errorText(err)})`);
  }
  const tokens = meter.embeddingTokens;
  return {
    chunks: buildEvalChunks(textChunks, vectors),
    tokens,
    costUsd: embeddingCostUsd(tokens, pricePerMillion),
  };
}

/**
 * Embeds a vacancy's criteria texts (once per vacancy per run) in one call and
 * records the tokens and cost on the extraction. Null, with `embeddingError`
 * set, when the call fails.
 */
async function embedCriteria(
  llm: LlmClient,
  meter: UsageMeter,
  extraction: ExtractionResult,
  pricePerMillion: number,
): Promise<number[][] | null> {
  meter.reset();
  try {
    const { vectors } = await llm.embed(extraction.criteria.map((c) => c.text));
    extraction.embeddingTokens = meter.embeddingTokens;
    extraction.embeddingCostUsd = embeddingCostUsd(
      meter.embeddingTokens,
      pricePerMillion,
    );
    extraction.embeddingError = null;
    console.log(
      `${extraction.vacancyId} run ${extraction.run}: ${extraction.criteria.length} criteria embedded, ${meter.embeddingTokens} embedding tokens`,
    );
    return vectors;
  } catch (err) {
    extraction.embeddingTokens = 0;
    extraction.embeddingCostUsd = 0;
    extraction.embeddingError = errorText(err);
    console.log(
      `${extraction.vacancyId} run ${extraction.run}: criteria embedding FAILED (${extraction.embeddingError})`,
    );
    return null;
  }
}

async function scorePair(params: {
  scorer: ApplicationScorer;
  meter: UsageMeter;
  vacancy: EvalVacancy;
  cvId: string;
  run: number;
  pricing: Pricing;
  criteria: VacancyCriterion[] | null;
  /** `rag` mode: retrieval settings and the criteria vectors; null in full text. */
  rag: { k: number; vectors: number[][] | null; error: string | null } | null;
  data: CvData | null;
  cvError: string | null;
  extractionError: string | null;
}): Promise<PairResult> {
  const { scorer, meter, vacancy, cvId, run, pricing } = params;
  const expected = vacancy.expect[cvId] ?? null;
  const base = {
    vacancyId: vacancy.id,
    cvId,
    run,
    expected,
  };
  const failed = (error: string): PairResult => {
    const usage = meter.usage;
    return {
      ...base,
      status: 'failed',
      error,
      overall: null,
      rationale: '',
      criteria: [],
      attempts: meter.attempts,
      usage,
      costUsd: costUsd(usage, pricing),
      band: null,
      bandResult: bandResult(null, expected),
      grounded: null,
      fillerSuspects: [],
    };
  };

  meter.reset();
  if (params.data === null)
    return failed(`CV ${params.cvError ?? 'unavailable'}`);
  if (params.criteria === null) {
    return failed(`no criteria (${params.extractionError ?? 'unknown'})`);
  }

  try {
    const { rag, data } = params;
    let retrieval: CriterionRetrieval[] | null = null;
    if (rag) {
      if (rag.vectors === null || data.chunks === null) {
        return failed(
          `no embeddings (${rag.error ?? 'chunks or criteria not embedded'})`,
        );
      }
      retrieval = retrieveForCriteria(
        params.criteria,
        rag.vectors,
        data.chunks,
        rag.k,
      );
    }
    const scored = retrieval
      ? await scorer.scoreRag({
          criteria: params.criteria,
          evidence: toEvidence(retrieval),
        })
      : await scorer.score({
          criteria: params.criteria,
          cvText: data.text,
          github: data.github,
        });
    const retrievedById = new Map(
      (retrieval ?? []).map((r) => [r.criterionId, r.chunks]),
    );
    const criteria = scored.criteria.map((c) => ({
      id: c.criterionId,
      text: c.criterion,
      importance: c.importance,
      score: c.score,
      reasoning: c.reasoning,
      quotes: c.quotes,
      ...(retrieval && { retrieved: retrievedById.get(c.criterionId) ?? [] }),
    }));
    const usage = meter.usage;
    return {
      ...base,
      status: 'scored',
      error: null,
      overall: scored.overall,
      rationale: scored.rationale,
      criteria,
      attempts: meter.attempts,
      usage,
      costUsd: costUsd(usage, pricing),
      band: bandOf(scored.overall),
      bandResult: bandResult(scored.overall, expected),
      grounded: retrieval
        ? checkGrounded(
            criteria,
            ragGroundingSources(retrieval.flatMap((r) => r.chunks)),
          )
        : checkGrounded(criteria, scorerSources(data.text, data.github)),
      fillerSuspects: findFillerSuspects(criteria),
      ...(retrieval && {
        evidenceCoverage: evidenceCoverage(retrieval, data.chunks!.length),
      }),
    };
  } catch (err) {
    return failed(errorText(err));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = err instanceof UsageError ? 2 : 1;
});
