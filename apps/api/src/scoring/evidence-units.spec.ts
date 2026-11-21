import type { GithubSnapshot } from '../github/github-snapshot.js';
import { buildGithubBlock } from '../llm/prompts/cv-profile.prompt.js';
import {
  cvUnits,
  githubUnits,
  MAX_UNIT_CHARS,
  segmentLines,
  segmentText,
} from './evidence-units.js';

const SOFIA = [
  'SKILLS',
  'Node.js',
  'PostgreSQL',
  'Backend Engineer \tSep 2025 – May 2026',
  'Zephyr Foundry',
  'Shaped service boundaries through system design and Microservices planning,',
  'aligning the backend with new product goals.',
  'Built containerized services with Docker and NestJS, using JavaScript and',
  'Express to speed up feature delivery across 3 services.',
  'Backend engineer with a track record of building reliable services, integrating APIs,',
  'and improving data flows across growing product teams. Experienced in REST',
  'APIs, Microservices, system design, and database-focused delivery.',
].join('\n');

function snapshot(overrides: Partial<GithubSnapshot> = {}): GithubSnapshot {
  return {
    username: 'janedoe',
    profileUrl: 'https://github.com/janedoe',
    status: 'ok',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    bio: null,
    repos: [
      {
        name: 'alpha',
        url: 'https://github.com/janedoe/alpha',
        description: null,
        language: 'TypeScript',
        stars: 50,
        topics: [],
        pushedAt: '2026-03-01T00:00:00Z',
        readmeExcerpt:
          'Alpha is a REST service built with NestJS. It ships a typed client for consumers.',
      },
    ],
    languages: [{ name: 'TypeScript', repoCount: 1 }],
    ...overrides,
  };
}

describe('segmentText', () => {
  it('merges wrapped bullet lines into one unit', () => {
    expect(segmentText(SOFIA)).toContain(
      'Built containerized services with Docker and NestJS, using JavaScript and Express to speed up feature delivery across 3 services.',
    );
  });

  it('keeps short lines (skills, headings, role/date lines) as their own units', () => {
    const units = segmentText(SOFIA);
    expect(units.slice(0, 5)).toEqual([
      'SKILLS',
      'Node.js',
      'PostgreSQL',
      'Backend Engineer \tSep 2025 – May 2026',
      'Zephyr Foundry',
    ]);
  });

  it('splits a merged paragraph into sentences', () => {
    const units = segmentText(SOFIA);
    expect(units).toContain(
      'Backend engineer with a track record of building reliable services, integrating APIs, and improving data flows across growing product teams.',
    );
    expect(units).toContain(
      'Experienced in REST APIs, Microservices, system design, and database-focused delivery.',
    );
  });

  it('never merges a short sidebar line into a bullet (two-column interleave)', () => {
    expect(
      segmentText(
        'Designed SQL queries and PostgreSQL tables to support cleaner\n2020\nreporting and fewer data inconsistencies.',
      ),
    ).toEqual([
      'Designed SQL queries and PostgreSQL tables to support cleaner',
      '2020',
      'reporting and fewer data inconsistencies.',
    ]);
    expect(
      segmentText('PostgreSQL\nDesigned SQL queries and PostgreSQL tables.'),
    ).toEqual(['PostgreSQL', 'Designed SQL queries and PostgreSQL tables.']);
  });

  it('joins a short line that ends the sentence', () => {
    expect(
      segmentText(
        'Optimized MySQL access patterns to improve throughput and keep deployments\npredictable.',
      ),
    ).toEqual([
      'Optimized MySQL access patterns to improve throughput and keep deployments predictable.',
    ]);
  });

  it('does not merge indented bullet lines', () => {
    const a =
      ' • Built the payments service with NestJS and PostgreSQL for the core team';
    const b =
      ' • Ran the on-call rotation and improved alerting across all services';
    expect(segmentText(`${a}\n${b}`)).toEqual([a, b]);
  });

  it('does not merge lines that start with a filled-circle bullet', () => {
    const a =
      '● Built the payments service with NestJS and PostgreSQL for the core team';
    const b =
      '● Ran the on-call rotation and improved alerting across all services';
    expect(segmentText(`${a}\n${b}`)).toEqual([a, b]);
  });

  it('joins a hyphen-wrapped word without a space', () => {
    expect(
      segmentText(
        'Built a checkout flow for the main online e-\ncommerce storefront team.',
      ),
    ).toEqual([
      'Built a checkout flow for the main online e-commerce storefront team.',
    ]);
  });

  it('does not merge across bullet markers', () => {
    expect(
      segmentText(
        '• Built the billing service for invoices and refunds\n• Ran Kubernetes clusters for the payments platform',
      ),
    ).toEqual([
      '• Built the billing service for invoices and refunds',
      '• Ran Kubernetes clusters for the payments platform',
    ]);
  });

  it('does not merge after a line ending with sentence punctuation', () => {
    expect(
      segmentText(
        'Built the billing service for invoices and refunds.\nRan Kubernetes clusters in production for years',
      ),
    ).toEqual([
      'Built the billing service for invoices and refunds.',
      'Ran Kubernetes clusters in production for years',
    ]);
  });

  it('caps units at MAX_UNIT_CHARS at word boundaries', () => {
    const sentence = Array.from({ length: 100 }, (_, i) => `word${i}`).join(
      ' ',
    );
    expect(sentence.length).toBeGreaterThan(600);
    const units = segmentText(sentence);
    expect(units.length).toBeGreaterThan(1);
    for (const unit of units) {
      expect(unit.length).toBeLessThanOrEqual(MAX_UNIT_CHARS);
    }
    expect(units.join(' ')).toBe(sentence);
  });

  it('hard-cuts a single word longer than MAX_UNIT_CHARS', () => {
    const units = segmentText('x'.repeat(700));
    expect(units.map((u) => u.length)).toEqual([300, 300, 100]);
  });

  it('segments Cyrillic text the same way', () => {
    expect(
      segmentText(
        'Розробив мікросервіс для обробки платежів та інтегрував його з\nбанківським API для швидших розрахунків.',
      ),
    ).toEqual([
      'Розробив мікросервіс для обробки платежів та інтегрував його з банківським API для швидших розрахунків.',
    ]);
    expect(
      segmentText(
        'Керував командою з п’яти людей. Налаштував CI для всіх сервісів.',
      ),
    ).toEqual([
      'Керував командою з п’яти людей.',
      'Налаштував CI для всіх сервісів.',
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(segmentText('SKILLS\r\nNode.js\r\n')).toEqual(['SKILLS', 'Node.js']);
  });

  it('returns [] for empty or whitespace-only text', () => {
    expect(segmentText('')).toEqual([]);
    expect(segmentText('  \n\t\n   ')).toEqual([]);
  });
});

describe('segmentLines', () => {
  it('segments each line on its own, with no cross-line merge', () => {
    expect(
      segmentLines(
        '## alpha (language: TypeScript, stars: 50, a long enough header line)\r\n\r\nDescription: a long description of the service well past the wrap threshold\nREADME: One. Two sentences here.',
      ),
    ).toEqual([
      '## alpha (language: TypeScript, stars: 50, a long enough header line)',
      'Description: a long description of the service well past the wrap threshold',
      'README: One.',
      'Two sentences here.',
    ]);
  });

  it('returns [] for blank text', () => {
    expect(segmentLines(' \n\n')).toEqual([]);
  });
});

describe('cvUnits', () => {
  it('numbers units S1..Sn in order with source cv', () => {
    const units = cvUnits('SKILLS\nNode.js\nPostgreSQL');
    expect(units).toEqual([
      { id: 'S1', source: 'cv', text: 'SKILLS' },
      { id: 'S2', source: 'cv', text: 'Node.js' },
      { id: 'S3', source: 'cv', text: 'PostgreSQL' },
    ]);
  });
});

describe('githubUnits', () => {
  it('strips the tags, splits the README line into sentences, keeps the repo header as a unit, numbers G1..Gn', () => {
    const units = githubUnits(buildGithubBlock(snapshot()));
    expect(units.map((u) => u.id)).toEqual(units.map((_, i) => `G${i + 1}`));
    expect(units.every((u) => u.source === 'github')).toBe(true);
    const texts = units.map((u) => u.text);
    expect(texts).toEqual([
      'Profile: https://github.com/janedoe',
      'Repositories (most starred first):',
      '## alpha (language: TypeScript, stars: 50)',
      'README: Alpha is a REST service built with NestJS.',
      'It ships a typed client for consumers.',
    ]);
    expect(texts.join('')).not.toContain('github>');
  });

  it('never glues a repo header onto its long description line', () => {
    const description =
      'A long description of the service that is well past the wrap threshold';
    const base = snapshot();
    const units = githubUnits(
      buildGithubBlock(
        snapshot({ repos: [{ ...base.repos[0], description }] }),
      ),
    ).map((u) => u.text);
    expect(units).toContain('## alpha (language: TypeScript, stars: 50)');
    expect(units).toContain(`Description: ${description}`);
  });

  it('keeps the truncated last section citable', () => {
    const repos = Array.from({ length: 6 }, (_, i) => ({
      ...snapshot().repos[0],
      name: `repo-${i}`,
      readmeExcerpt: 'x '.repeat(1_500),
    }));
    const block = buildGithubBlock(snapshot({ repos }));
    expect(block).toContain('…\n</github>');
    const units = githubUnits(block);
    const last = units[units.length - 1];
    expect(last.text.endsWith('…')).toBe(true);
    expect(last.id).toBe(`G${units.length}`);
    expect(last.text.length).toBeLessThanOrEqual(MAX_UNIT_CHARS);
  });
});
