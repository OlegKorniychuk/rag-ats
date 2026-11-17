import { findTags, findTagsInTopic, mentions } from './aliases.js';
import { loadDraftData } from './test-data.js';
import type { Taxonomy } from './types.js';

let taxonomy: Taxonomy;
beforeAll(async () => {
  ({ taxonomy } = await loadDraftData());
});

const tags = (text: string): string[] => [...findTags(text, taxonomy)].sort();

describe('findTags: word boundaries', () => {
  it('matches whole words case-insensitively', () => {
    expect(tags('Built APIs in python and postgres')).toEqual([
      'postgresql',
      'python',
    ]);
  });

  it('does not match inside longer words', () => {
    expect(tags('JavaScript tooling')).toEqual(['javascript']);
    expect(tags('PostgreSQL and NoSQL')).toEqual(['postgresql']);
    expect(tags('Reactive streams, Gopher, Rusty')).toEqual([]);
  });

  it('handles symbols and dots in aliases', () => {
    expect(tags('Wrote C++ and C# code')).toEqual(['cpp', 'csharp']);
    expect(tags('Services on Node.js with Next.js')).toEqual([
      'nextjs',
      'nodejs',
    ]);
    expect(tags('Pipelines with CI/CD and GitHub Actions')).toEqual([
      'ci-cd',
      'github-actions',
    ]);
  });

  it('allows hyphenated compounds of unambiguous aliases', () => {
    expect(tags('A Python-based, React-driven tool')).toEqual(['python']);
  });

  it('keeps the longest overlapping match', () => {
    expect(tags('Mobile apps in React Native')).toEqual(['react-native']);
    expect(tags('Workflows in GitHub Actions')).toEqual(['github-actions']);
    expect(tags('C++ only')).toEqual(['cpp']);
  });

  it('ignores URLs', () => {
    expect(tags('See https://github.com/synth-x/docker-tools')).toEqual([]);
  });

  it('never matches experience tags', () => {
    expect(tags('exp-backend exp-ml')).toEqual([]);
  });

  it('matches all-caps acronyms only in caps, with plural', () => {
    expect(tags('Designed REST endpoints and LLMs')).toEqual([
      'llm',
      'rest-api',
    ]);
    expect(tags('Worked with the rest of the team')).toEqual([]);
    expect(tags('Query tuning for sql engines')).toEqual([]);
    expect(tags('Query tuning for SQL engines')).toEqual(['sql']);
  });

  it('matches the word Node only capitalised', () => {
    expect(tags('Each node in the cluster')).toEqual([]);
    expect(tags('Node services')).toEqual(['nodejs']);
  });

  it('works for Ukrainian text around Latin tech names', () => {
    expect(tags('Розробив сервіси на Python та Docker')).toEqual([
      'docker',
      'python',
    ]);
  });
});

describe('findTags: ambiguous tags', () => {
  it('rejects ordinary uses of Go, R and C', () => {
    expect(tags('Led the Go to market plan')).toEqual([]);
    expect(tags('Worked in R&D on a pilot')).toEqual([]);
    expect(tags('We kept Plan C in reserve')).toEqual([]);
    expect(tags('Go-to-market strategy')).toEqual([]);
    expect(tags('Let us Go ahead')).toEqual([]);
  });

  it('is case-sensitive', () => {
    expect(tags('wrote services using go')).toEqual([]);
    expect(tags('wrote services using Go')).toEqual(['go']);
  });

  it('accepts a tech phrase', () => {
    expect(tags('Services written in Go')).toEqual(['go']);
    expect(tags('Built dashboards with R')).toEqual(['r']);
    expect(tags('Firmware using C and assembly')).toEqual(['c']);
    expect(tags('Migrated to Rust')).toEqual(['rust']);
    expect(tags('Сервіси на Go')).toEqual(['go']);
  });

  it('accepts a tech noun after it', () => {
    expect(tags('Maintained Go services')).toEqual(['go']);
    expect(tags('Built React components')).toEqual(['react']);
    expect(tags('Worked in an Agile team')).toEqual(['agile']);
    expect(tags('Shipped a Swift app')).toEqual(['swift']);
  });

  it('accepts list items next to another alias', () => {
    expect(tags('Stack: Python, Go, Docker')).toEqual([
      'docker',
      'go',
      'python',
    ]);
    expect(tags('Python, Go and Docker')).toEqual(['docker', 'go', 'python']);
    expect(tags('Languages: Go / Rust')).toEqual(['go', 'rust']);
  });

  it('accepts a skills-section entry on its own', () => {
    expect(tags('Go')).toEqual(['go']);
    expect(tags('R.')).toEqual(['r']);
  });

  it('rejects a capitalised word that is not a list item', () => {
    expect(tags('In Spring 2023 we shipped Python and more')).toEqual([
      'python',
    ]);
    expect(tags('Sales and Go to market, Python')).toEqual(['python']);
    expect(tags('Plan C and Python')).toEqual(['python']);
    expect(tags('The Express delivery team, Docker')).toEqual(['docker']);
  });

  it('needs no context for multi-token aliases, but keeps them case-sensitive', () => {
    expect(tags('Built Spring Boot services')).toEqual(['spring-boot']);
    expect(tags('spring boot')).toEqual([]);
    expect(tags('Used Express.js')).toEqual(['express']);
    expect(tags('Ran PySpark jobs')).toEqual(['spark']);
  });
});

describe('mentions', () => {
  it('checks one tag', () => {
    expect(mentions('Deployed on Kubernetes', 'kubernetes', taxonomy)).toBe(
      true,
    );
    expect(mentions('Deployed on Kubernetes', 'docker', taxonomy)).toBe(false);
  });

  it('finds every taxonomy label as its own tag', () => {
    const bad = taxonomy.tags
      .filter((t) => t.kind !== 'experience')
      .filter((t) => !mentions(`Skills: ${t.label}`, t.tag, taxonomy))
      .map((t) => t.tag);
    expect(bad).toEqual([]);
  });

  it('finds the labels in a sentence with "using"', () => {
    const bad = taxonomy.tags
      .filter((t) => t.kind !== 'experience')
      .filter(
        (t) => !mentions(`Built services using ${t.label}.`, t.tag, taxonomy),
      )
      .map((t) => t.tag);
    expect(bad).toEqual([]);
  });
});

describe('findTagsInTopic', () => {
  it('matches a topic token to an alias', () => {
    expect([...findTagsInTopic('go', taxonomy)]).toEqual(['go']);
    expect([...findTagsInTopic('node-js', taxonomy)]).toContain('nodejs');
    expect([...findTagsInTopic('react-native', taxonomy)]).toEqual([
      'react-native',
    ]);
    expect([...findTagsInTopic('cli', taxonomy)]).toEqual([]);
  });
});
