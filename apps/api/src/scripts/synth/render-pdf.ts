/** Headless Chromium printing and the production-extractor check of a PDF. */
import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFParse } from 'pdf-parse';
import { CvTextExtractor } from '../../cv/cv-text-extractor.js';
import type { CvContent } from './cv-content.js';
import { findMissingSnippets } from './cv-check.js';

export const DEFAULT_CHROMIUM = 'chromium';
export const PRINT_TIMEOUT_MS = 60_000;
/** More pages than this is reported as a warning, not a failure. */
export const MAX_PAGES = 2;

export const chromiumBin = (): string =>
  process.env.CHROMIUM_BIN?.trim() || DEFAULT_CHROMIUM;

/** True when `bin` is an executable path, or a command found on PATH. */
export function chromiumAvailable(bin = chromiumBin()): boolean {
  const candidates = bin.includes('/')
    ? [bin]
    : (process.env.PATH ?? '').split(':').map((d) => join(d, bin));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Prints `htmlPath` to `pdfPath` (flags as in data/checkpoint-a/render.sh).
 * Every run gets its own profile directory so parallel runs don't hand over
 * to one another's browser process.
 */
export async function printToPdf(
  htmlPath: string,
  pdfPath: string,
  bin = chromiumBin(),
  timeoutMs = PRINT_TIMEOUT_MS,
): Promise<void> {
  const profile = await mkdtemp(join(tmpdir(), 'synth-chromium-'));
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin,
        [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--no-pdf-header-footer',
          `--user-data-dir=${profile}`,
          `--print-to-pdf=${pdfPath}`,
          pathToFileURL(htmlPath).href,
        ],
        { timeout: timeoutMs, killSignal: 'SIGKILL' },
        (error, _stdout, stderr) => {
          if (!error) return resolve();
          const reason =
            'killed' in error && error.killed
              ? `timed out after ${timeoutMs} ms`
              : error.message;
          reject(
            new Error(`${bin} failed: ${reason}\n${stderr.slice(-500)}`.trim()),
          );
        },
      );
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

export async function countPages(pdf: Buffer): Promise<number> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await parser.getInfo()).total;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export interface PdfCheck {
  pages: number;
  /** Snippets of the CV that the production extractor did not return. */
  missing: string[];
  warnings: string[];
}

/** Reads the PDF the way the app does and compares it with the CV content. */
export async function checkPdf(pdf: Buffer, cv: CvContent): Promise<PdfCheck> {
  const text = await new CvTextExtractor().extract(pdf);
  const pages = await countPages(pdf);
  const warnings =
    pages > MAX_PAGES ? [`${pages} pages (expected at most ${MAX_PAGES})`] : [];
  return { pages, missing: findMissingSnippets(cv, text), warnings };
}
