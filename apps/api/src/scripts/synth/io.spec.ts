import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'prettier';
import { loadVacancies, writeJson } from './io.js';

describe('io', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synth-io-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('writes prettier-stable JSON', async () => {
    const path = join(dir, 'nested', 'x.json');
    await writeJson(path, { a: [1, 2, 3], b: { c: 'd' } });
    const text = await readFile(path, 'utf8');
    expect(await format(text, { parser: 'json' })).toBe(text);
    expect(JSON.parse(text)).toEqual({ a: [1, 2, 3], b: { c: 'd' } });
  });

  it('prefers vacancies.json over the draft', async () => {
    await writeFile(join(dir, 'vacancies.draft.json'), '[{"id":"draft"}]');
    expect((await loadVacancies(dir))[0].id).toBe('draft');
    await writeFile(join(dir, 'vacancies.json'), '[{"id":"final"}]');
    expect((await loadVacancies(dir))[0].id).toBe('final');
  });
});
