/**
 * `synth spot-check --ui`: a local web page for labelling the blind sample.
 * Serves the pairs from sample.json (rendered with the same blind helpers as
 * sample.md), saves every band and note straight into labels.json, and scores
 * the labels once all pairs have a band. Binds to 127.0.0.1 only.
 */
import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';
import { UsageError } from '../../shared/cli.js';
import { exists, readJson, writeJson } from '../io.js';
import { SPOT_CHECK_PAGE } from '../spot-check-page.js';
import {
  BANDS,
  missingLabels,
  renderCvMarkdown,
  renderGithubMarkdown,
  type LabelEntry,
  type SampleFile,
} from '../spot-check.js';
import type { Band } from '../types.js';
import { renderVacancyText } from '../vacancies.js';
import { loadSampleEntries, scoreLabels } from './spot-check.js';

/** One pair as the page shows it: no ids, no ground truth. */
export interface UiPair {
  pair: number;
  vacancyTitle: string;
  vacancyText: string;
  cvMarkdown: string;
  githubMarkdown: string | null;
}

const MAX_NOTE = 2000;
const MAX_BODY = 16 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Body is not JSON');
  }
}

function parseLabelUpdate(body: unknown): { band: Band | null; note: string } {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Body must be an object');
  }
  const { band, note } = body as { band?: unknown; note?: unknown };
  if (band !== null && !BANDS.includes(band as Band)) {
    throw new HttpError(400, `band must be null or one of ${BANDS.join(', ')}`);
  }
  if (typeof note !== 'string' || note.length > MAX_NOTE) {
    throw new HttpError(400, `note must be a string of at most ${MAX_NOTE}`);
  }
  return { band: band as Band | null, note };
}

/** Builds the server for the sample in `dir` (call `listen` on it). */
export async function createSpotCheckServer(dir: string): Promise<Server> {
  const out = join(dir, 'spot-check');
  const samplePath = join(out, 'sample.json');
  const labelsPath = join(out, 'labels.json');
  if (!(await exists(samplePath)) || !(await exists(labelsPath))) {
    throw new UsageError(
      `No sample in ${out}. Run "synth spot-check --sample 30" first.`,
    );
  }
  const sampleFile = await readJson<SampleFile>(samplePath);
  const entries = await loadSampleEntries(dir, sampleFile);
  const pairs: UiPair[] = entries.map((e) => ({
    pair: e.pair,
    vacancyTitle: e.vacancy.title,
    // The title is shown on its own, so drop it from the body.
    vacancyText: renderVacancyText(e.vacancy)
      .trim()
      .split('\n')
      .slice(1)
      .join('\n')
      .trim(),
    cvMarkdown: renderCvMarkdown(e.cv),
    githubMarkdown: e.github ? renderGithubMarkdown(e.github) : null,
  }));
  const pdfByPair = new Map(
    sampleFile.pairs.map((p) => [
      p.pair,
      join(dir, 'pdf', `${p.personaId}.pdf`),
    ]),
  );

  // labels.json stays the source of truth (it may also be edited by hand);
  // writes are queued so two quick clicks never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const updateLabel = (
    pair: number,
    update: { band: Band | null; note: string },
  ): Promise<LabelEntry> => {
    const run = queue.then(async () => {
      const labels = await readJson<LabelEntry[]>(labelsPath);
      const entry = labels.find((l) => l.pair === pair);
      if (!entry) throw new HttpError(404, `No pair ${pair}`);
      entry.band = update.band;
      entry.note = update.note;
      await writeJson(labelsPath, labels);
      return entry;
    });
    queue = run.catch(() => undefined);
    return run;
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && path === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(SPOT_CHECK_PAGE);
      return;
    }
    if (method === 'GET' && path === '/api/sample') {
      const labels = await readJson<LabelEntry[]>(labelsPath);
      sendJson(res, 200, {
        seed: sampleFile.seed,
        pairs,
        labels: labels.map(({ pair, band, note }) => ({ pair, band, note })),
      });
      return;
    }
    const labelMatch = /^\/api\/labels\/(\d+)$/.exec(path);
    if (method === 'PUT' && labelMatch) {
      const update = parseLabelUpdate(await readBody(req));
      const entry = await updateLabel(Number(labelMatch[1]), update);
      sendJson(res, 200, {
        pair: entry.pair,
        band: entry.band,
        note: entry.note,
      });
      return;
    }
    const pdfMatch = /^\/pdf\/(\d+)$/.exec(path);
    if (method === 'GET' && pdfMatch) {
      const file = pdfByPair.get(Number(pdfMatch[1]));
      if (!file || !(await exists(file))) throw new HttpError(404, 'No PDF');
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'cache-control': 'no-store',
      });
      res.end(await readFile(file));
      return;
    }
    if (method === 'POST' && path === '/api/score') {
      const labels = await readJson<LabelEntry[]>(labelsPath);
      const missing = missingLabels(labels);
      if (missing.length > 0) {
        throw new HttpError(409, 'Some pairs have no band yet', { missing });
      }
      await queue; // never score half-written labels
      sendJson(res, 200, await scoreLabels(dir));
      return;
    }
    throw new HttpError(404, 'Not found');
  };

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, ...err.body });
        return;
      }
      console.error(err);
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

/** Starts the page and keeps running until Ctrl+C. */
export async function runSpotCheckUi(dir: string, port: number): Promise<void> {
  const server = await createSpotCheckServer(dir);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(
    `Spot-check UI on http://127.0.0.1:${port} (labels save to ${join(dir, 'spot-check', 'labels.json')}). Ctrl+C to stop.`,
  );
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      server.close(() => resolve());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
