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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '../../shared/cli.js';
import { loadPersonas, SYNTH_DIR, writeJson } from '../io.js';
import type { LabelEntry, SampleFile } from '../spot-check.js';
import { cvFromPersona } from '../test-cvs.js';
import type { GroundTruth, PersonaSpec, VacancySpec } from '../types.js';
import { runSpotCheck } from './spot-check.js';

jest.setTimeout(60_000);

describe('synth spot-check', () => {
  let dir: string;
  let personas: PersonaSpec[];
  let truth: GroundTruth;
  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(join(dir, 'spot-check', file), 'utf8')) as T;

  beforeAll(async () => {
    personas = (await loadPersonas(SYNTH_DIR)).personas;
    truth = JSON.parse(
      await readFile(join(SYNTH_DIR, 'ground-truth.json'), 'utf8'),
    ) as GroundTruth;
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synth-spot-'));
    for (const f of [
      'personas.json',
      'ground-truth.json',
      'vacancies.draft.json',
    ]) {
      await copyFile(join(SYNTH_DIR, f), join(dir, f));
    }
    await mkdir(join(dir, 'cvs'));
    for (const p of personas) {
      await writeFile(
        join(dir, 'cvs', `${p.id}.json`),
        JSON.stringify(cvFromPersona(p)),
      );
    }
    // One GitHub fixture, for whichever sampled persona owns it.
    await mkdir(join(dir, 'github'));
    for (const p of personas.filter((x) => x.github)) {
      await writeFile(
        join(dir, 'github', `${p.github!.username}.json`),
        JSON.stringify({
          user: { login: p.github!.username, bio: 'Fixture bio' },
          repos: [
            {
              name: 'fixture-repo',
              description: 'Fixture repo description',
              language: 'Python',
              topics: ['fixture-topic'],
            },
          ],
          readmes: {},
        }),
      );
    }
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes sample.md, sample.json and empty labels.json', async () => {
    await runSpotCheck(['--sample', '30', '--seed', '4'], dir);
    const sample = await read<SampleFile>('sample.json');
    const labels = await read<LabelEntry[]>('labels.json');
    expect(sample.pairs).toHaveLength(30);
    expect(labels).toHaveLength(30);
    expect(labels[0]).toEqual({
      pair: 1,
      vacancyId: sample.pairs[0].vacancyId,
      personaId: sample.pairs[0].personaId,
      band: null,
      note: '',
    });
    expect(new Set(sample.pairs.map((p) => p.personaId)).size).toBe(30);

    // Stratified: 10 per rule band.
    const bandOf = new Map(
      truth.pairs.map((p) => [`${p.vacancyId}/${p.personaId}`, p.band]),
    );
    const counts = { strong: 0, partial: 0, weak: 0 };
    for (const p of sample.pairs) {
      counts[bandOf.get(`${p.vacancyId}/${p.personaId}`)!]++;
    }
    expect(counts).toEqual({ strong: 10, partial: 10, weak: 10 });
  });

  it('is deterministic for a seed', async () => {
    await runSpotCheck(['--sample', '30', '--seed', '9'], dir);
    const first = await readFile(join(dir, 'spot-check', 'sample.md'), 'utf8');
    await runSpotCheck(['--sample', '30', '--seed', '9'], dir);
    expect(await readFile(join(dir, 'spot-check', 'sample.md'), 'utf8')).toBe(
      first,
    );
  });

  it('is blind: no score, band, persona kind, requirement status or persona id', async () => {
    await runSpotCheck(['--sample', '30', '--seed', '2'], dir);
    const md = await readFile(join(dir, 'spot-check', 'sample.md'), 'utf8');
    const sample = await read<SampleFile>('sample.json');

    expect(md).toContain('## Pair 1');
    expect(md).toContain('## Pair 30');
    expect(md).toContain('Fixture repo description');

    // No ground-truth field names or values.
    expect(md).not.toMatch(/^\s*[-*]?\s*(score|band|kind|target|flags)\s*:/im);
    expect(md).not.toMatch(/score\s*[:=]\s*\d/i);
    for (const word of [
      'not_met',
      'off_target',
      'targeted',
      'keyword_stuffer',
      'career_switcher',
      'bootcamp',
      'github_only',
      'cv_skills_only',
      'cv_role',
    ]) {
      expect(md).not.toContain(word);
    }
    const vacancies = JSON.parse(
      await readFile(join(dir, 'vacancies.draft.json'), 'utf8'),
    ) as VacancySpec[] | { vacancies: VacancySpec[] };
    const reqIds = (
      Array.isArray(vacancies) ? vacancies : vacancies.vacancies
    ).flatMap((v) => v.requirements.map((r) => r.id));
    for (const id of reqIds) expect(md).not.toContain(id);
    // The vacancy ids and persona ids only appear in the PDF paths.
    const withoutPdfLines = md.replace(/^PDF: .*$/gm, '');
    for (const p of sample.pairs) {
      expect(withoutPdfLines).not.toContain(p.personaId);
    }
    expect(md.match(/^PDF: \.\.\/pdf\/p\d{3}\.pdf$/gm)).toHaveLength(30);
    // The vacancy text is there in full.
    expect(md).toMatch(/Requirements\n- /);
  });

  it('refuses to overwrite filled labels unless --force', async () => {
    await runSpotCheck(['--sample', '12', '--seed', '1'], dir);
    // Untouched labels may be regenerated.
    await runSpotCheck(['--sample', '12', '--seed', '2'], dir);

    const path = join(dir, 'spot-check', 'labels.json');
    const labels = await read<LabelEntry[]>('labels.json');
    labels[0].band = 'weak';
    await writeJson(path, labels);
    const before = await readFile(path, 'utf8');

    await expect(
      runSpotCheck(['--sample', '12', '--seed', '3'], dir),
    ).rejects.toThrow(/--force/);
    expect(await readFile(path, 'utf8')).toBe(before);

    await runSpotCheck(['--sample', '12', '--seed', '3', '--force'], dir);
    const after = await read<LabelEntry[]>('labels.json');
    expect(after.every((l) => l.band === null)).toBe(true);
  });

  it('also protects a note written without a band', async () => {
    await runSpotCheck(['--sample', '6'], dir);
    const labels = await read<LabelEntry[]>('labels.json');
    labels[1].note = 'looks senior';
    await writeJson(join(dir, 'spot-check', 'labels.json'), labels);
    await expect(runSpotCheck(['--sample', '6'], dir)).rejects.toThrow(
      /--force/,
    );
  });

  it('--score lists the missing pairs and fails as a usage error', async () => {
    await runSpotCheck(['--sample', '9', '--seed', '1'], dir);
    const labels = await read<LabelEntry[]>('labels.json');
    labels[0].band = 'strong';
    labels[3].band = 'partial';
    await writeJson(join(dir, 'spot-check', 'labels.json'), labels);

    const error = await runSpotCheck(['--score'], dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('pair(s) 2, 3, 5, 6, 7, 8, 9');
    await expect(
      readFile(join(dir, 'spot-check', 'agreement.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('--score without labels.json says to run --sample first', async () => {
    await expect(runSpotCheck(['--score'], dir)).rejects.toThrow(/--sample/);
  });

  it('--score writes agreement.md and agreement.json', async () => {
    await runSpotCheck(['--sample', '12', '--seed', '5'], dir);
    const sample = await read<SampleFile>('sample.json');
    const bandOf = new Map(
      truth.pairs.map((p) => [`${p.vacancyId}/${p.personaId}`, p.band]),
    );
    const labels = await read<LabelEntry[]>('labels.json');
    // Agree everywhere except pair 1, where strong/partial are swapped.
    for (const l of labels) {
      l.band = bandOf.get(`${l.vacancyId}/${l.personaId}`)!;
    }
    const rule = labels[0].band!;
    labels[0].band = rule === 'weak' ? 'strong' : 'weak';
    await writeJson(join(dir, 'spot-check', 'labels.json'), labels);

    await runSpotCheck(['--score'], dir);
    const agreement = await read<{
      pairs: number;
      exactAgreement: number;
      kappa: number;
      confusion: number[][];
      disagreements: Array<{
        pair: number;
        requirements: Array<{ status: string }>;
      }>;
    }>('agreement.json');
    expect(agreement.pairs).toBe(12);
    expect(agreement.exactAgreement).toBeCloseTo(11 / 12, 10);
    expect(agreement.kappa).toBeLessThan(1);
    expect(agreement.disagreements.map((d) => d.pair)).toEqual([1]);
    expect(agreement.disagreements[0].requirements.length).toBeGreaterThan(0);
    expect(agreement.confusion.flat().reduce((a, b) => a + b, 0)).toBe(12);

    const md = await readFile(join(dir, 'spot-check', 'agreement.md'), 'utf8');
    expect(md).toContain('Exact band agreement: 91.7%');
    expect(md).toContain(`### Pair 1: ${sample.pairs[0].personaId}`);
  });

  it('--score rejects an invalid band value', async () => {
    await runSpotCheck(['--sample', '6'], dir);
    const labels = await read<LabelEntry[]>('labels.json');
    for (const l of labels) l.band = 'strong';
    (labels[2] as { band: string }).band = 'good';
    await writeJson(join(dir, 'spot-check', 'labels.json'), labels);
    await expect(runSpotCheck(['--score'], dir)).rejects.toThrow(/pair\(s\) 3/);
  });

  it('needs exactly one of --sample or --score', async () => {
    await expect(runSpotCheck([], dir)).rejects.toThrow(UsageError);
    await expect(
      runSpotCheck(['--score', '--sample', '5'], dir),
    ).rejects.toThrow(UsageError);
    await expect(runSpotCheck(['--sample', 'abc'], dir)).rejects.toThrow(
      /--sample/,
    );
  });

  it('only samples personas that have a CV', async () => {
    const keep = new Set(personas.slice(0, 12).map((p) => p.id));
    for (const p of personas) {
      if (!keep.has(p.id)) await rm(join(dir, 'cvs', `${p.id}.json`));
    }
    await runSpotCheck(['--sample', '30', '--seed', '1'], dir);
    const sample = await read<SampleFile>('sample.json');
    expect(sample.pairs.length).toBeLessThanOrEqual(12);
    expect(sample.pairs.every((p) => keep.has(p.personaId))).toBe(true);
  });
});
