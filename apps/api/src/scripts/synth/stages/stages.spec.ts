import 'reflect-metadata'; // shared/cli.js pulls in decorated env config
import { jest } from '@jest/globals';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SYNTH_DIR } from '../io.js';
import type { GroundTruth, SearchQuery } from '../types.js';
import { runLabels } from './labels.js';
import { runPersonas } from './personas.js';

// Generates and prettier-formats ~1 MB of JSON: slow under a parallel full run.
jest.setTimeout(60_000);

describe('synth stages', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synth-stages-'));
    for (const f of ['taxonomy.json', 'vacancies.draft.json', 'queries.json']) {
      await copyFile(join(SYNTH_DIR, f), join(dir, f));
    }
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('personas writes the file and refuses to overwrite without --force', async () => {
    await runPersonas(['--seed', '1'], dir);
    const first = await readFile(join(dir, 'personas.json'), 'utf8');
    expect(JSON.parse(first).personas).toHaveLength(100);

    await expect(runPersonas(['--seed', '2'], dir)).rejects.toThrow(/--force/);
    expect(await readFile(join(dir, 'personas.json'), 'utf8')).toBe(first);

    await runPersonas(['--seed', '1', '--force'], dir);
    expect(await readFile(join(dir, 'personas.json'), 'utf8')).toBe(first);
  });

  it('personas rejects a bad seed', async () => {
    await expect(runPersonas(['--seed', 'abc'], dir)).rejects.toThrow(/--seed/);
    await expect(runPersonas(['--seed', '0'], dir)).rejects.toThrow(/--seed/);
  });

  it('labels writes 1000 pairs and fills the queries', async () => {
    await runPersonas(['--seed', '1'], dir);
    await runLabels([], dir);
    const gt = JSON.parse(
      await readFile(join(dir, 'ground-truth.json'), 'utf8'),
    ) as GroundTruth;
    expect(gt.pairs).toHaveLength(1000);
    const queries = JSON.parse(
      await readFile(join(dir, 'queries.json'), 'utf8'),
    ) as SearchQuery[];
    expect(queries.every((q) => Array.isArray(q.relevant))).toBe(true);
    expect(queries.filter((q) => q.relevant!.length > 0).length).toBe(
      queries.length,
    );
  });

  it('labels needs personas first', async () => {
    await expect(runLabels([], dir)).rejects.toThrow(/personas\.json/);
  });
});
