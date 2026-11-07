import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadManifest } from '../parse-eval/manifest.js';
import {
  loadVacancySet,
  parseVacancySet,
  VacancySetError,
} from './vacancies.js';

const CV_IDS = ['01-a', '02-b'];

const validVacancy = {
  id: 'v1',
  title: 'Backend Engineer',
  requirements: '5+ years of Java',
  notes: 'n',
  expect: { '01-a': 'strong', '02-b': 'weak' },
};

const parse = (vacancies: unknown[]) =>
  parseVacancySet({ description: 'd', vacancies }, CV_IDS);

describe('parseVacancySet', () => {
  it('accepts a valid set', () => {
    const set = parse([
      { ...validVacancy, mustCoverTerms: ['Java'] },
      { ...validVacancy, id: 'v2', expect: { '01-a': 'partial' } },
    ]);
    expect(set.description).toBe('d');
    expect(set.vacancies).toHaveLength(2);
    expect(set.vacancies[0].expect['02-b']).toBe('weak');
    expect(set.vacancies[0].mustCoverTerms).toEqual(['Java']);
    expect(set.vacancies[1].mustCoverTerms).toBeUndefined();
  });

  it('defaults missing notes, expect and description', () => {
    const rest: Partial<typeof validVacancy> = { ...validVacancy };
    delete rest.notes;
    delete rest.expect;
    const set = parseVacancySet({ vacancies: [rest] }, CV_IDS);
    expect(set.description).toBe('');
    expect(set.vacancies[0].notes).toBe('');
    expect(set.vacancies[0].expect).toEqual({});
  });

  it('rejects an unknown CV id and names it', () => {
    expect(() =>
      parse([{ ...validVacancy, expect: { '99-zzz': 'strong' } }]),
    ).toThrow(/unknown CV id "99-zzz"/);
  });

  it('rejects an invalid band and names the allowed values', () => {
    expect(() =>
      parse([{ ...validVacancy, expect: { '01-a': 'great' } }]),
    ).toThrow(/must be one of strong, partial, weak/);
  });

  it('rejects a duplicate vacancy id', () => {
    expect(() => parse([validVacancy, validVacancy])).toThrow(
      /duplicate id "v1"/,
    );
  });

  it('rejects empty requirements', () => {
    expect(() => parse([{ ...validVacancy, requirements: '  ' }])).toThrow(
      /vacancies\[0\]\.requirements must be a non-empty string/,
    );
  });

  it.each([
    ['non-array', 'Java'],
    ['empty string item', ['Java', '']],
    ['non-string item', [1]],
  ])('rejects mustCoverTerms that is a %s', (_name, terms) => {
    expect(() => parse([{ ...validVacancy, mustCoverTerms: terms }])).toThrow(
      /mustCoverTerms must be an array of non-empty strings/,
    );
  });

  it.each([
    ['non-object', 42],
    ['missing vacancies', {}],
    ['empty vacancies', { vacancies: [] }],
    ['non-object entry', { vacancies: ['x'] }],
    ['missing id', { vacancies: [{ ...validVacancy, id: undefined }] }],
    ['empty title', { vacancies: [{ ...validVacancy, title: '' }] }],
    ['non-object expect', { vacancies: [{ ...validVacancy, expect: [] }] }],
    ['non-string notes', { vacancies: [{ ...validVacancy, notes: 5 }] }],
    ['non-string description', { description: 5, vacancies: [validVacancy] }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseVacancySet(input, CV_IDS)).toThrow(VacancySetError);
  });
});

function findRepoFile(...segments: string[]): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${segments.join('/')} not found`);
    dir = parent;
  }
}

describe('committed Checkpoint B vacancy set', () => {
  it('loads against the Checkpoint A manifest ids', async () => {
    const manifest = await loadManifest(
      findRepoFile('data', 'checkpoint-a', 'manifest.json'),
    );
    const set = await loadVacancySet(
      findRepoFile('data', 'checkpoint-b', 'vacancies.json'),
      manifest.cvs.map((cv) => cv.id),
    );

    expect(set.vacancies.map((v) => v.id)).toEqual([
      'backend-java',
      'frontend-react',
      'data-ml',
      'devops-platform',
    ]);

    for (const vacancy of set.vacancies) {
      const bands = Object.values(vacancy.expect);
      // data-ml and devops-platform have a single strong match in the CV set.
      expect(bands.filter((b) => b === 'strong').length).toBeGreaterThanOrEqual(
        1,
      );
      expect(bands.filter((b) => b === 'weak').length).toBeGreaterThanOrEqual(
        2,
      );
    }

    const dataMl = set.vacancies.find((v) => v.id === 'data-ml');
    expect(dataMl?.mustCoverTerms?.length).toBeGreaterThanOrEqual(12);
  });
});
