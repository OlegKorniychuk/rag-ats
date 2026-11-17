import { parseArgs } from 'node:util';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseNumber, UsageError } from '../../shared/cli.js';
import type { CvContent } from '../cv-content.js';
import { validateCvContent } from '../cv-check.js';
import { exists, loadPersonas, readJson } from '../io.js';
import { LAYOUTS, renderCvHtml } from '../render-html.js';
import {
  checkPdf,
  chromiumAvailable,
  chromiumBin,
  printToPdf,
} from '../render-pdf.js';
import type { Layout } from '../types.js';

export const RENDER_USAGE = `synth render [--only <ids>] [--force] [--concurrency N]
  Renders cvs/<id>.json to cvs/<id>.html and pdf/<id>.pdf with headless
  Chromium (CHROMIUM_BIN, default "chromium"), then reads every PDF with the
  production text extractor and fails when any CV text is missing. No LLM calls.`;

export type RenderStatus = 'rendered' | 'skipped' | 'failed';

export interface RenderResult {
  id: string;
  layout?: Layout;
  status: RenderStatus;
  pages?: number;
  warnings: string[];
  /** Why it failed: missing snippets or an error message. */
  problems: string[];
}

async function mtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; keeps the order. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

export function formatRenderSummary(results: RenderResult[]): string {
  const count = (s: RenderStatus) =>
    results.filter((r) => r.status === s).length;
  const lines = [
    `Rendered ${count('rendered')}, skipped ${count('skipped')}, failed ${count('failed')} (${results.length} CVs)`,
  ];
  for (const layout of LAYOUTS) {
    const pages = new Map<number, number>();
    for (const r of results) {
      if (r.layout === layout && r.pages !== undefined) {
        pages.set(r.pages, (pages.get(r.pages) ?? 0) + 1);
      }
    }
    if (pages.size === 0) continue;
    const parts = [...pages]
      .sort(([a], [b]) => a - b)
      .map(([n, c]) => `${c} x ${n} page${n === 1 ? '' : 's'}`);
    lines.push(`  ${layout}: ${parts.join(', ')}`);
  }
  for (const r of results.filter((x) => x.warnings.length > 0)) {
    lines.push(`  warning ${r.id}: ${r.warnings.join('; ')}`);
  }
  return lines.join('\n');
}

/** `synth render`: JSON -> HTML -> PDF, then the extraction check. */
export async function runRender(argv: string[], dir: string): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      only: { type: 'string' },
      force: { type: 'boolean', default: false },
      concurrency: { type: 'string' },
    },
    strict: true,
  });
  const concurrency = parseNumber('concurrency', values.concurrency, 4, true);
  const only = values.only
    ? new Set(values.only.split(/[\s,]+/).filter(Boolean))
    : null;

  const cvDir = join(dir, 'cvs');
  const pdfDir = join(dir, 'pdf');
  const available = (await exists(cvDir))
    ? (await readdir(cvDir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length))
        .sort()
    : [];
  if (available.length === 0) {
    throw new UsageError(
      `No cvs/<id>.json in ${dir}. Run "synth cvs" first (or put CV content files there).`,
    );
  }
  if (only) {
    const unknown = [...only].filter((id) => !available.includes(id));
    if (unknown.length > 0) {
      throw new UsageError(`No cvs/<id>.json for: ${unknown.join(', ')}`);
    }
  }
  const ids = available.filter((id) => !only || only.has(id));

  const bin = chromiumBin();
  if (!chromiumAvailable(bin)) {
    throw new UsageError(
      `Chromium not found ("${bin}"). Install it or set CHROMIUM_BIN.`,
    );
  }

  const { personas } = await loadPersonas(dir);
  const layoutOf = new Map(personas.map((p) => [p.id, p.layout]));
  const templates = new Map<Layout, { html: string; mtime: number }>();
  for (const layout of LAYOUTS) {
    const path = join(dir, 'templates', `${layout}.html`);
    if (!(await exists(path))) {
      throw new UsageError(`Missing template ${path}`);
    }
    templates.set(layout, {
      html: await readFile(path, 'utf8'),
      mtime: (await mtimeMs(path)) ?? 0,
    });
  }
  await mkdir(pdfDir, { recursive: true });

  const renderOne = async (id: string): Promise<RenderResult> => {
    const result: RenderResult = {
      id,
      status: 'failed',
      warnings: [],
      problems: [],
    };
    try {
      const jsonPath = join(cvDir, `${id}.json`);
      const cv = await readJson<CvContent>(jsonPath);
      const invalid = validateCvContent(cv);
      if (invalid.length > 0) {
        result.problems.push(`invalid CV content: ${invalid.join('; ')}`);
        return result;
      }
      const layout = layoutOf.get(id);
      if (!layout) {
        result.problems.push('no persona with this id in personas.json');
        return result;
      }
      result.layout = layout;
      const template = templates.get(layout)!;

      const htmlPath = join(cvDir, `${id}.html`);
      const pdfPath = join(pdfDir, `${id}.pdf`);
      const pdfTime = await mtimeMs(pdfPath);
      const sourceTime = Math.max(
        (await mtimeMs(jsonPath)) ?? 0,
        template.mtime,
      );
      const stale = pdfTime === null || pdfTime < sourceTime;
      if (values.force || stale) {
        await writeFile(htmlPath, renderCvHtml(cv, layout, template.html));
        await printToPdf(htmlPath, pdfPath, bin);
        result.status = 'rendered';
      } else {
        result.status = 'skipped';
      }

      // Checked even when skipped, so a bad PDF cannot hide behind the cache.
      const check = await checkPdf(await readFile(pdfPath), cv);
      result.pages = check.pages;
      result.warnings = check.warnings;
      if (check.missing.length > 0) {
        result.status = 'failed';
        result.problems = check.missing.map((s) => `missing text: "${s}"`);
      }
    } catch (error) {
      result.status = 'failed';
      result.problems.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    return result;
  };

  const results = await mapPool(ids, concurrency, renderOne);
  console.log(formatRenderSummary(results));

  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    const detail = failed
      .map(
        (r) =>
          `  ${r.id}${r.layout ? ` (${r.layout})` : ''}:\n    ${r.problems.join('\n    ')}`,
      )
      .join('\n');
    throw new Error(
      `${failed.length} CV(s) failed the render or extraction check:\n${detail}`,
    );
  }
}
