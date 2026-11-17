import 'reflect-metadata'; // shared/cli.js pulls in decorated env config
import { jest } from '@jest/globals';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '../../shared/cli.js';
import { SYNTH_DIR } from '../io.js';
import { chromiumAvailable, chromiumBin } from '../render-pdf.js';
import { FIXTURE_CVS } from '../test-cvs.js';
import {
  formatRenderSummary,
  mapPool,
  runRender,
  type RenderResult,
} from './render.js';

describe('mapPool', () => {
  it('keeps the order and never exceeds the limit', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapPool([5, 1, 4, 2, 3, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60]);
    expect(peak).toBe(2);
  });
});

describe('formatRenderSummary', () => {
  it('counts statuses and pages per layout, and lists warnings', () => {
    const base = { warnings: [], problems: [] };
    const results: RenderResult[] = [
      { id: 'a', layout: '1-col', status: 'rendered', pages: 1, ...base },
      { id: 'b', layout: '1-col', status: 'skipped', pages: 2, ...base },
      { id: 'c', layout: '2-col', status: 'rendered', pages: 1, ...base },
      {
        id: 'd',
        layout: '2-col',
        status: 'rendered',
        pages: 3,
        warnings: ['3 pages (expected at most 2)'],
        problems: [],
      },
      { id: 'e', status: 'failed', warnings: [], problems: ['boom'] },
    ];
    expect(formatRenderSummary(results)).toBe(
      [
        'Rendered 3, skipped 1, failed 1 (5 CVs)',
        '  1-col: 1 x 1 page, 1 x 2 pages',
        '  2-col: 1 x 1 page, 1 x 3 pages',
        '  warning d: 3 pages (expected at most 2)',
      ].join('\n'),
    );
  });
});

describe('synth render', () => {
  let dir: string;
  let log: ReturnType<typeof jest.spyOn>;
  const logged = (): string =>
    log.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synth-render-'));
    await copyFile(
      join(SYNTH_DIR, 'personas.json'),
      join(dir, 'personas.json'),
    );
    await cp(join(SYNTH_DIR, 'templates'), join(dir, 'templates'), {
      recursive: true,
    });
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const writeCvs = async (): Promise<void> => {
    await mkdir(join(dir, 'cvs'), { recursive: true });
    for (const cv of FIXTURE_CVS) {
      await writeFile(
        join(dir, 'cvs', `${cv.personaId}.json`),
        JSON.stringify(cv),
      );
    }
  };

  it('asks for the cvs stage when there is no CV content', async () => {
    await expect(runRender([], dir)).rejects.toThrow(/synth cvs/);
  });

  it('rejects unknown --only ids and bad flags', async () => {
    await writeCvs();
    await expect(runRender(['--only', 'p999'], dir)).rejects.toThrow(/p999/);
    await expect(runRender(['--concurrency', '0'], dir)).rejects.toThrow(
      UsageError,
    );
  });

  it('fails clearly when Chromium is missing', async () => {
    await writeCvs();
    const saved = process.env.CHROMIUM_BIN;
    process.env.CHROMIUM_BIN = '/nonexistent/chromium';
    try {
      await expect(runRender([], dir)).rejects.toThrow(/Chromium not found/);
    } finally {
      if (saved === undefined) delete process.env.CHROMIUM_BIN;
      else process.env.CHROMIUM_BIN = saved;
    }
  });

  const available = chromiumAvailable();
  if (!available) {
    console.warn(
      `Skipping Chromium render tests: "${chromiumBin()}" not found (set CHROMIUM_BIN to run them).`,
    );
  }
  const chromiumIt = available ? it : it.skip;

  chromiumIt(
    'renders PDFs for every layout, extracts them with the production extractor, and skips fresh ones',
    async () => {
      await writeCvs();
      await runRender([], dir);
      expect(logged()).toContain('Rendered 5, skipped 0, failed 0 (5 CVs)');
      expect(logged()).toMatch(/1-col: 1 x 1 page/);
      expect(logged()).toMatch(/compact: 2 x 1 page/);
      for (const cv of FIXTURE_CVS) {
        const pdf = await readFile(join(dir, 'pdf', `${cv.personaId}.pdf`));
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(
          await readFile(join(dir, 'cvs', `${cv.personaId}.html`), 'utf8'),
        ).toContain(`<html lang="${cv.language}">`);
      }

      // A second run finds the PDFs newer than their JSON and only re-checks.
      const before = (await stat(join(dir, 'pdf', 'p005.pdf'))).mtimeMs;
      log.mockClear();
      await runRender([], dir);
      expect(logged()).toContain('Rendered 0, skipped 5, failed 0');
      expect((await stat(join(dir, 'pdf', 'p005.pdf'))).mtimeMs).toBe(before);

      // --force renders again, --only limits the work.
      log.mockClear();
      await runRender(['--only', 'p005,p029', '--force'], dir);
      expect(logged()).toContain('Rendered 2, skipped 0, failed 0 (2 CVs)');

      // An edited CV is newer than its PDF and is rendered again.
      const future = new Date(Date.now() + 60_000);
      await utimes(join(dir, 'cvs', 'p036.json'), future, future);
      log.mockClear();
      await runRender(['--only', 'p036', '--concurrency', '1'], dir);
      expect(logged()).toContain('Rendered 1, skipped 0');
    },
    120_000,
  );

  chromiumIt(
    'fails with the persona id and the missing text when a PDF lost content',
    async () => {
      await writeCvs();
      await runRender(['--only', 'p005'], dir);
      // p001's PDF is replaced by another CV's: fresh enough to be skipped,
      // but its text is not p001's, so the extraction check must catch it.
      await copyFile(
        join(dir, 'pdf', 'p005.pdf'),
        join(dir, 'pdf', 'p001.pdf'),
      );
      const future = new Date(Date.now() + 60_000);
      await utimes(join(dir, 'pdf', 'p001.pdf'), future, future);

      const error = await runRender(['--only', 'p001'], dir).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UsageError);
      const message = (error as Error).message;
      expect(message).toContain('1 CV(s) failed');
      expect(message).toContain('p001 (2-col)');
      expect(message).toContain('missing text: "Machine Learning Engineer"');
      expect(logged()).toContain('failed 1');
    },
    120_000,
  );

  chromiumIt(
    'fails on an unreadable PDF instead of skipping it',
    async () => {
      await writeCvs();
      await mkdir(join(dir, 'pdf'), { recursive: true });
      await writeFile(join(dir, 'pdf', 'p062.pdf'), 'not a pdf');
      const error = await runRender(['--only', 'p062'], dir).catch(
        (e: unknown) => e,
      );
      expect((error as Error).message).toContain('p062');
      expect((error as Error).message).toContain('Could not read text');
    },
    120_000,
  );
});
