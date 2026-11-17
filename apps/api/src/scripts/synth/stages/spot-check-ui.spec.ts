import 'reflect-metadata'; // shared/cli.js pulls in decorated env config
import { jest } from '@jest/globals';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '../../shared/cli.js';
import { loadPersonas, readJson, SYNTH_DIR } from '../io.js';
import type { Agreement, LabelEntry, SampleFile } from '../spot-check.js';
import { cvFromPersona } from '../test-cvs.js';
import type { GroundTruth } from '../types.js';
import { runSpotCheck } from './spot-check.js';
import { createSpotCheckServer, type UiPair } from './spot-check-ui.js';

jest.setTimeout(60_000);

describe('synth spot-check --ui server', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let sample: SampleFile;
  const labelsPath = (): string => join(dir, 'spot-check', 'labels.json');
  const put = (pair: number, body: unknown): Promise<Response> =>
    fetch(`${base}/api/labels/${pair}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synth-spot-ui-'));
    for (const f of [
      'personas.json',
      'ground-truth.json',
      'vacancies.draft.json',
    ]) {
      await copyFile(join(SYNTH_DIR, f), join(dir, f));
    }
    const { personas } = await loadPersonas(SYNTH_DIR);
    await mkdir(join(dir, 'cvs'));
    for (const p of personas) {
      await writeFile(
        join(dir, 'cvs', `${p.id}.json`),
        JSON.stringify(cvFromPersona(p)),
      );
    }
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await runSpotCheck(['--sample', '6', '--seed', '3'], dir);
    sample = await readJson<SampleFile>(join(dir, 'spot-check', 'sample.json'));
    // Only the first pair has a PDF.
    await mkdir(join(dir, 'pdf'));
    await writeFile(
      join(dir, 'pdf', `${sample.pairs[0].personaId}.pdf`),
      '%PDF-1.4 fixture',
    );

    server = await createSpotCheckServer(dir);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the page', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>Spot-check</title>');
  });

  it('serves the pairs blind: no persona ids, bands or scores', async () => {
    const res = await fetch(`${base}/api/sample`);
    const body = (await res.json()) as {
      seed: number;
      pairs: UiPair[];
      labels: Array<{ pair: number; band: string | null; note: string }>;
    };
    expect(body.seed).toBe(3);
    expect(body.pairs.map((p) => p.pair)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(body.pairs[0].vacancyText).toMatch(/^[^\n]+[\s\S]*Requirements\n- /);
    expect(body.pairs[0].vacancyText).not.toContain(
      body.pairs[0].vacancyTitle + '\n',
    );
    expect(body.labels[0]).toEqual({ pair: 1, band: null, note: '' });

    const raw = JSON.stringify(body);
    for (const p of sample.pairs) expect(raw).not.toContain(p.personaId);
    expect(raw).not.toMatch(/"score"|"rule"|not_met|off_target/);
  });

  it('saves a band and note into labels.json', async () => {
    const res = await put(2, { band: 'partial', note: 'some React' });
    expect(res.status).toBe(200);
    const labels = await readJson<LabelEntry[]>(labelsPath());
    expect(labels[1]).toEqual({
      ...sample.pairs[1],
      band: 'partial',
      note: 'some React',
    });
    expect(labels[0].band).toBeNull();

    await put(2, { band: null, note: '' });
    expect((await readJson<LabelEntry[]>(labelsPath()))[1].band).toBeNull();
  });

  it('keeps concurrent saves from losing each other', async () => {
    await Promise.all(
      sample.pairs.map((p) =>
        put(p.pair, { band: 'weak', note: `n${p.pair}` }),
      ),
    );
    const labels = await readJson<LabelEntry[]>(labelsPath());
    expect(labels.map((l) => l.note)).toEqual(
      sample.pairs.map((p) => `n${p.pair}`),
    );
    for (const p of sample.pairs) await put(p.pair, { band: null, note: '' });
  });

  it('rejects a bad band, a bad note and an unknown pair', async () => {
    expect((await put(1, { band: 'good', note: '' })).status).toBe(400);
    expect((await put(1, { band: 'weak' })).status).toBe(400);
    expect(
      (await put(1, { band: 'weak', note: 'x'.repeat(2001) })).status,
    ).toBe(400);
    expect((await put(99, { band: 'weak', note: '' })).status).toBe(404);
    const bad = await fetch(`${base}/api/labels/1`, {
      method: 'PUT',
      body: 'not json',
    });
    expect(bad.status).toBe(400);
    expect((await readJson<LabelEntry[]>(labelsPath()))[0].band).toBeNull();
  });

  it('serves a pair PDF by pair number only', async () => {
    const ok = await fetch(`${base}/pdf/1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(await ok.text()).toBe('%PDF-1.4 fixture');
    expect((await fetch(`${base}/pdf/2`)).status).toBe(404);
    expect((await fetch(`${base}/pdf/99`)).status).toBe(404);
    expect((await fetch(`${base}/pdf/..%2Fpersonas.json`)).status).toBe(404);
  });

  it('refuses to score until every pair has a band, then scores', async () => {
    await put(1, { band: 'strong', note: '' });
    const early = await fetch(`${base}/api/score`, { method: 'POST' });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { missing: number[] }).missing).toEqual([
      2, 3, 4, 5, 6,
    ]);

    const truth = await readJson<GroundTruth>(join(dir, 'ground-truth.json'));
    for (const p of sample.pairs) {
      const gt = truth.pairs.find(
        (t) => t.vacancyId === p.vacancyId && t.personaId === p.personaId,
      )!;
      await put(p.pair, { band: gt.band, note: '' });
    }
    const res = await fetch(`${base}/api/score`, { method: 'POST' });
    expect(res.status).toBe(200);
    const agreement = (await res.json()) as Agreement;
    expect(agreement.pairs).toBe(6);
    expect(agreement.exactAgreement).toBe(1);
    expect(agreement.disagreements).toEqual([]);
    expect(
      await readFile(join(dir, 'spot-check', 'agreement.md'), 'utf8'),
    ).toContain('Exact band agreement: 100.0%');
  });

  it('needs a sample first', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'synth-spot-ui-empty-'));
    await expect(createSpotCheckServer(empty)).rejects.toThrow(UsageError);
    await rm(empty, { recursive: true, force: true });
  });
});
