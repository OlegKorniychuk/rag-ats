import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { CvTextExtractor, isPdf } from '../../src/cv/cv-text-extractor.js';

interface ManifestEntry {
  id: string;
  file: string;
  githubUrl: string | null;
  language: string;
  layout: string;
  notes: string;
  expect: {
    mustHaveSkills: string[];
    forbiddenInSkills: string[];
    expectedProjects: string[];
    expectedEmployers: string[];
    forbiddenAnywhere: string[];
  };
}

const MANIFEST_PATH = ['data', 'checkpoint-a', 'manifest.json'];

function findCvSetDir(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, ...MANIFEST_PATH))) {
      return dirname(join(dir, ...MANIFEST_PATH));
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('data/checkpoint-a/manifest.json not found');
    }
    dir = parent;
  }
}

const cvSetDir = findCvSetDir();
const manifest = JSON.parse(
  readFileSync(join(cvSetDir, 'manifest.json'), 'utf8'),
) as { cvs: ManifestEntry[] };

describe('checkpoint A CV set', () => {
  const extractor = new CvTextExtractor();

  it('has 8 entries with unique ids', () => {
    expect(manifest.cvs).toHaveLength(8);
    expect(new Set(manifest.cvs.map((cv) => cv.id)).size).toBe(8);
  });

  describe.each(manifest.cvs.map((cv) => [cv.id, cv] as const))(
    '%s',
    (_id, cv) => {
      const path = join(cvSetDir, cv.file);

      it('has a PDF file that passes the PDF check', () => {
        expect(existsSync(path)).toBe(true);
        expect(isPdf(readFileSync(path))).toBe(true);
      });

      it('has an HTML source', () => {
        expect(existsSync(join(cvSetDir, 'src', `${cv.id}.html`))).toBe(true);
      });

      it('extracts text containing every expected employer', async () => {
        const text = await extractor.extract(readFileSync(path));
        const haystack = text.toLowerCase();

        expect(text.length).toBeGreaterThan(0);
        for (const employer of cv.expect.expectedEmployers) {
          expect({
            employer,
            found: haystack.includes(employer.toLowerCase()),
          }).toEqual({ employer, found: true });
        }
      });
    },
  );
});
