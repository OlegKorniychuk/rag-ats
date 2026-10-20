import { readFile } from 'node:fs/promises';

export interface CvExpectations {
  /** Each must be contained in at least one `skills` entry. */
  mustHaveSkills: string[];
  /** No `skills` entry may contain any of these. */
  forbiddenInSkills: string[];
  /** Each must be contained in at least one `projects` entry. */
  expectedProjects: string[];
  /** Each must appear in `experience`. */
  expectedEmployers: string[];
  /** Each (e.g. a key achievement metric) must appear in `experience`. */
  experienceMustMention: string[];
  /** No `projects` entry may contain any of these (duties, unnamed work). */
  forbiddenInProjects: string[];
  /** Must appear in no field (skills, projects, experience, summary). */
  forbiddenAnywhere: string[];
}

export interface ManifestCv {
  id: string;
  /** PDF file name, relative to the manifest's directory. */
  file: string;
  githubUrl: string | null;
  language: string;
  layout: string;
  notes: string;
  expect: CvExpectations;
}

export interface Manifest {
  cvs: ManifestCv[];
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`Invalid manifest: ${message}`);
    this.name = 'ManifestError';
  }
}

const EXPECT_KEYS: (keyof CvExpectations)[] = [
  'mustHaveSkills',
  'forbiddenInSkills',
  'expectedProjects',
  'expectedEmployers',
  'experienceMustMention',
  'forbiddenInProjects',
  'forbiddenAnywhere',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ManifestError(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function parseExpect(raw: unknown, where: string): CvExpectations {
  if (!isRecord(raw)) throw new ManifestError(`${where} must be an object`);
  const out = {} as CvExpectations;
  for (const key of EXPECT_KEYS) {
    const value = raw[key] ?? [];
    if (
      !Array.isArray(value) ||
      !value.every((v) => typeof v === 'string' && v.trim() !== '')
    ) {
      throw new ManifestError(
        `${where}.${key} must be an array of non-empty strings`,
      );
    }
    out[key] = value as string[];
  }
  return out;
}

/** Validates the manifest shape; throws `ManifestError` with a clear message. */
export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw) || !Array.isArray(raw.cvs)) {
    throw new ManifestError('expected an object with a "cvs" array');
  }
  if (raw.cvs.length === 0) throw new ManifestError('"cvs" must not be empty');

  const seen = new Set<string>();
  const cvs = raw.cvs.map((entry: unknown, index: number): ManifestCv => {
    const where = `cvs[${index}]`;
    if (!isRecord(entry)) throw new ManifestError(`${where} must be an object`);

    const id = requireString(entry, 'id', where);
    if (seen.has(id)) throw new ManifestError(`duplicate id "${id}"`);
    seen.add(id);

    const githubUrl = entry.githubUrl ?? null;
    if (githubUrl !== null && typeof githubUrl !== 'string') {
      throw new ManifestError(`${where}.githubUrl must be a string or null`);
    }
    const notes = entry.notes ?? '';
    if (typeof notes !== 'string') {
      throw new ManifestError(`${where}.notes must be a string`);
    }

    return {
      id,
      file: requireString(entry, 'file', where),
      githubUrl: githubUrl as string | null,
      language: requireString(entry, 'language', where),
      layout: requireString(entry, 'layout', where),
      notes,
      expect: parseExpect(entry.expect, `${where}.expect`),
    };
  });

  return { cvs };
}

export async function loadManifest(path: string): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new ManifestError(`cannot read ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ManifestError(`${path} is not valid JSON`);
  }
  return parseManifest(json);
}
