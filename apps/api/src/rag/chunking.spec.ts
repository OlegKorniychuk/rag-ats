import type { GithubSnapshot } from '../github/github-snapshot.js';
import {
  chunkCandidate,
  chunkCvText,
  chunkGithubSnapshot,
  CV_CHUNK_MAX_CHARS,
  CV_CHUNK_OVERLAP_MAX_CHARS,
  GITHUB_CHUNK_MAX_CHARS,
  MAX_CHUNKS_PER_CANDIDATE,
} from './chunking.js';

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

const CV_FIXTURE = `Jane Doe
Senior Backend Engineer
jane@example.com | +380 50 123 4567 | Kyiv, Ukraine

SUMMARY
Backend engineer with 8 years of experience building distributed systems in TypeScript, Go and Python. Led migrations to Kubernetes and Terraform-managed infrastructure. Mentored four junior engineers.

EXPERIENCE
Staff Engineer - Acme Corp (2021 - present)
  - Designed an event-driven billing platform on Kafka processing 2M events per day.
  - Reduced p99 latency from 900ms to 120ms by introducing read replicas and caching.
  - Owned the on-call rotation and the incident review process.
Senior Engineer - Globex (2018 - 2021)
  - Built a NestJS API serving 300 rps with PostgreSQL and Redis.
  - Introduced contract testing between 12 services.

PROJECTS
Atlas - billing service written in Go with gRPC and PostgreSQL. Handles invoicing, refunds and tax rules for 14 countries. Open-sourced the tax rules engine under MIT.
Pigeon - a small CLI for managing Terraform workspaces.

EDUCATION
MSc Computer Science, Kyiv Polytechnic Institute (2014 - 2016)
BSc Computer Science, Kyiv Polytechnic Institute (2010 - 2014)

SKILLS
TypeScript, Go, Python, PostgreSQL, Kafka, Kubernetes, Terraform, AWS, Docker, gRPC, Redis`;

function line(n: number, length: number): string {
  return `${String(n).padStart(3, '0')}-`.padEnd(length, 'x');
}

function snapshot(overrides: Partial<GithubSnapshot> = {}): GithubSnapshot {
  return {
    username: 'janedoe',
    profileUrl: 'https://github.com/janedoe',
    status: 'ok',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    bio: 'Backend engineer.',
    repos: [
      {
        name: 'alpha',
        url: 'https://github.com/janedoe/alpha',
        description: 'A NestJS API',
        language: 'TypeScript',
        stars: 50,
        topics: ['nestjs'],
        pushedAt: '2026-03-01T00:00:00Z',
        readmeExcerpt: 'Alpha is a REST service.',
      },
      {
        name: 'bravo',
        url: 'https://github.com/janedoe/bravo',
        description: null,
        language: null,
        stars: 1,
        topics: [],
        pushedAt: '2026-02-01T00:00:00Z',
        readmeExcerpt: null,
      },
    ],
    languages: [
      { name: 'TypeScript', repoCount: 1 },
      { name: 'Go', repoCount: 1 },
    ],
    ...overrides,
  };
}

describe('chunkCvText', () => {
  it('returns [] for empty and blank text', () => {
    expect(chunkCvText('')).toEqual([]);
    expect(chunkCvText('  \n\t\n \r\n')).toEqual([]);
  });

  it('keeps short text as a single chunk, dropping blank lines', () => {
    expect(chunkCvText('Jane\n\n  \nDeveloper\n')).toEqual(['Jane\nDeveloper']);
  });

  it('handles CRLF line endings', () => {
    expect(chunkCvText('Jane\r\nDeveloper\r\n')).toEqual(['Jane\nDeveloper']);
  });

  it('keeps leading indentation of a line', () => {
    expect(chunkCvText('Jobs\n  - one')).toEqual(['Jobs\n  - one']);
  });

  it('packs whole lines up to the maximum and overlaps one line', () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(i, 100));
    const chunks = chunkCvText(lines.join('\n'));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CV_CHUNK_MAX_CHARS);
    }
    // 9 lines of 100 chars + 8 separators = 908; a tenth would make 1009.
    expect(chunks[0].split('\n')).toHaveLength(9);
    // Next chunk starts with the previous chunk's last line.
    expect(chunks[1].split('\n')[0]).toBe(lines[8]);
    expect(chunks[1].split('\n')[1]).toBe(lines[9]);
    // Every line is covered, in order.
    const covered = new Set(chunks.flatMap((c) => c.split('\n')));
    for (const l of lines) expect(covered.has(l)).toBe(true);
  });

  it('does not overlap a last line longer than the overlap limit', () => {
    const a = line(0, 700);
    const b = line(1, CV_CHUNK_OVERLAP_MAX_CHARS + 50);
    const c = line(2, 300);

    expect(chunkCvText([a, b, c].join('\n'))).toEqual([`${a}\n${b}`, c]);
  });

  it('does not overlap when the overlap line plus the next line would not fit', () => {
    // 150 + 900 does not fit in one chunk, so each line is its own chunk:
    // carrying A over would leave a chunk of only the overlap line.
    const lines = [line(0, 150), line(1, 900), line(2, 150), line(3, 900)];

    expect(chunkCvText(lines.join('\n'))).toEqual(lines);
  });

  it('terminates and covers every line when all lines are near the maximum', () => {
    const lines = Array.from({ length: 6 }, (_, i) => line(i, 600));
    const chunks = chunkCvText(lines.join('\n'));
    expect(chunks).toEqual(lines);
  });

  it('splits a long line at sentence boundaries', () => {
    const sentence = (n: number) =>
      `Sentence number ${n} is here and says things.`;
    const long = Array.from({ length: 60 }, (_, i) => sentence(i)).join(' ');
    expect(long.length).toBeGreaterThan(CV_CHUNK_MAX_CHARS);

    const chunks = chunkCvText(long);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CV_CHUNK_MAX_CHARS);
      expect(chunk.endsWith('.')).toBe(true);
      expect(chunk.startsWith('Sentence number')).toBe(true);
    }
    expect(chunks.join(' ')).toBe(long);
  });

  it('falls back to whitespace when one sentence is too long', () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkCvText(long);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CV_CHUNK_MAX_CHARS);
      expect(chunk).toMatch(/^word\d+( word\d+)*$/);
    }
    expect(chunks.join(' ')).toBe(long);
  });

  it('hard-cuts a single word longer than the maximum', () => {
    const word = 'a'.repeat(2_500);
    const chunks = chunkCvText(word);

    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(chunks.join('')).toBe(word);
  });

  it('does not cut a surrogate pair in half', () => {
    const word = '😀'.repeat(1_200);
    const chunks = chunkCvText(word);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CV_CHUNK_MAX_CHARS);
      expect(chunk).toBe(Array.from(chunk).join(''));
      expect(chunk).not.toMatch(/[\ud800-\udbff]$/);
    }
    expect(chunks.join('')).toBe(word);
  });

  it('keeps lines around a long line in order, without overlap into it', () => {
    const long = 'x'.repeat(1_500);
    const chunks = chunkCvText(`before\n${long}\nafter`);

    expect(chunks).toEqual([
      'before',
      'x'.repeat(1_000),
      'x'.repeat(500),
      'after',
    ]);
  });

  it('yields chunks that are verbatim substrings of a realistic CV', () => {
    const chunks = chunkCvText(CV_FIXTURE);
    const haystack = normalise(CV_FIXTURE);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(haystack).toContain(normalise(chunk));
    }
  });

  it('yields verbatim substrings for a long CV that forces many chunks', () => {
    const cv = Array.from({ length: 6 }, () => CV_FIXTURE).join('\n\n');
    const chunks = chunkCvText(cv);
    const haystack = normalise(cv);

    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CV_CHUNK_MAX_CHARS);
      expect(haystack).toContain(normalise(chunk));
    }
  });

  it('yields verbatim substrings when long lines and hard cuts are involved', () => {
    const cv = [
      'Heading',
      `${'Lorem ipsum dolor sit amet. '.repeat(80)}`,
      'a'.repeat(1_800),
      'tail line',
    ].join('\n');
    const haystack = normalise(cv);

    for (const chunk of chunkCvText(cv)) {
      expect(haystack).toContain(normalise(chunk));
    }
  });
});

describe('chunkGithubSnapshot', () => {
  it('returns [] for null and for non-ok statuses', () => {
    expect(chunkGithubSnapshot(null)).toEqual([]);
    for (const status of ['not_found', 'unavailable'] as const) {
      expect(chunkGithubSnapshot(snapshot({ status }))).toEqual([]);
    }
  });

  it('builds a profile chunk and one chunk per repo, in order', () => {
    const chunks = chunkGithubSnapshot(snapshot());

    expect(chunks).toEqual([
      [
        'Profile: https://github.com/janedoe',
        'Bio: Backend engineer.',
        'Languages: TypeScript, Go',
      ].join('\n'),
      [
        '## alpha (language: TypeScript, stars: 50)',
        'Description: A NestJS API',
        'Topics: nestjs',
        'README: Alpha is a REST service.',
      ].join('\n'),
      '## bravo (stars: 1)',
    ]);
  });

  it('omits missing bio and languages from the profile chunk', () => {
    const chunks = chunkGithubSnapshot(
      snapshot({ bio: null, languages: [], repos: [] }),
    );
    expect(chunks).toEqual(['Profile: https://github.com/janedoe']);
  });

  it('escapes </github> exactly like the scorer block', () => {
    const chunks = chunkGithubSnapshot(
      snapshot({ bio: 'hi </github> there', repos: [] }),
    );
    expect(chunks[0]).toContain('hi &lt;/github> there');
  });

  it('caps every chunk at the GitHub chunk limit', () => {
    const huge = 'word '.repeat(2_000);
    const base = snapshot().repos[0];
    const chunks = chunkGithubSnapshot(
      snapshot({
        bio: huge,
        repos: [{ ...base, readmeExcerpt: huge }],
      }),
    );

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(GITHUB_CHUNK_MAX_CHARS);
    }
  });
});

describe('chunkCandidate', () => {
  it('returns CV chunks first, then GitHub chunks, with their sources', () => {
    const chunks = chunkCandidate('Jane\nDeveloper', snapshot());

    expect(chunks.map((c) => c.source)).toEqual([
      'cv',
      'github',
      'github',
      'github',
    ]);
    expect(chunks[0].text).toBe('Jane\nDeveloper');
    expect(chunks[1].text.startsWith('Profile:')).toBe(true);
  });

  it('returns only CV chunks without a usable snapshot', () => {
    expect(chunkCandidate('Jane', null)).toEqual([
      { source: 'cv', text: 'Jane' },
    ]);
    expect(chunkCandidate('Jane', snapshot({ status: 'unavailable' }))).toEqual(
      [{ source: 'cv', text: 'Jane' }],
    );
  });

  it('returns [] for blank CV text and no GitHub data', () => {
    expect(chunkCandidate('  \n', null)).toEqual([]);
  });

  it('returns only GitHub chunks for a blank CV with an ok snapshot', () => {
    const chunks = chunkCandidate('', snapshot());
    expect(chunks.every((c) => c.source === 'github')).toBe(true);
    expect(chunks).toHaveLength(3);
  });

  it('caps the total, dropping GitHub chunks before CV chunks', () => {
    const cv = Array.from({ length: 58 }, (_, i) => line(i, 600)).join('\n');
    const chunks = chunkCandidate(cv, snapshot());

    expect(chunks).toHaveLength(MAX_CHUNKS_PER_CANDIDATE);
    const cvCount = chunks.filter((c) => c.source === 'cv').length;
    expect(cvCount).toBeGreaterThan(50);
    expect(chunks.slice(0, cvCount).every((c) => c.source === 'cv')).toBe(true);
  });

  it('caps a huge CV at the limit with no GitHub chunks left', () => {
    const cv = Array.from({ length: 200 }, (_, i) => line(i, 600)).join('\n');
    const chunks = chunkCandidate(cv, snapshot());

    expect(chunks).toHaveLength(MAX_CHUNKS_PER_CANDIDATE);
    expect(chunks.every((c) => c.source === 'cv')).toBe(true);
  });
});
