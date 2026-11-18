// cli.ts pulls in EnvConfig, whose decorators need the Reflect metadata polyfill.
import 'reflect-metadata';
import { UsageError } from '../shared/cli.js';
import { parseEvalArgs } from './args.js';

describe('parseEvalArgs', () => {
  it('applies the defaults', () => {
    expect(parseEvalArgs(['--label', 'run1'])).toEqual({
      command: 'run',
      part: 'all',
      modes: ['full_text', 'rag'],
      label: 'run1',
      seed: 1,
      weak: 150,
      noise: 50,
      limit: null,
      concurrency: 4,
      maxUsd: 6,
      retryFailed: false,
      sample: null,
      summariseFile: null,
    });
  });

  it('reads every flag', () => {
    expect(
      parseEvalArgs([
        '--part',
        'scoring',
        '--modes',
        'rag',
        '--label',
        'smoke.1',
        '--seed',
        '7',
        '--weak',
        '20',
        '--noise',
        '0',
        '--limit',
        '10',
        '--concurrency',
        '2',
        '--max-usd',
        '0.5',
        '--retry-failed',
      ]),
    ).toMatchObject({
      command: 'run',
      part: 'scoring',
      modes: ['rag'],
      label: 'smoke.1',
      seed: 7,
      weak: 20,
      noise: 0,
      limit: 10,
      concurrency: 2,
      maxUsd: 0.5,
      retryFailed: true,
    });
  });

  it('needs no label for a dry run or a review summary', () => {
    expect(parseEvalArgs(['--dry-run'])).toMatchObject({
      command: 'dry-run',
      label: null,
    });
    expect(parseEvalArgs(['--summarise-review', 'x.md'])).toMatchObject({
      command: 'summarise-review',
      summariseFile: 'x.md',
    });
  });

  it('requires a label otherwise, and a safe one', () => {
    expect(() => parseEvalArgs([])).toThrow(UsageError);
    expect(() => parseEvalArgs(['--report-only'])).toThrow(/--label/);
    expect(() => parseEvalArgs(['--label', '../x'])).toThrow(/letters/);
  });

  it('parses the modes list, dedupes it and rejects unknown ones', () => {
    expect(
      parseEvalArgs(['--label', 'a', '--modes', 'rag, full_text,rag']).modes,
    ).toEqual(['rag', 'full_text']);
    expect(() => parseEvalArgs(['--label', 'a', '--modes', 'rag,x'])).toThrow(
      /unknown mode "x"/,
    );
  });

  it('rejects a bad part', () => {
    expect(() => parseEvalArgs(['--label', 'a', '--part', 'x'])).toThrow(
      /--part/,
    );
  });

  it.each([
    ['--seed', '1.5'],
    ['--seed', '-1'],
    ['--weak', 'abc'],
    ['--noise', '-3'],
    ['--limit', '0'],
    ['--concurrency', '0'],
    ['--max-usd', '0'],
    ['--max-usd', '-2'],
    ['--max-usd', ''],
  ])('rejects %s %s', (flag, value) => {
    expect(() => parseEvalArgs(['--label', 'a', flag, value])).toThrow(
      UsageError,
    );
  });

  it('accepts seed 0 and a zero noise or weak count', () => {
    expect(
      parseEvalArgs(['--label', 'a', '--seed', '0', '--weak', '0']),
    ).toMatchObject({ seed: 0, weak: 0 });
  });

  it('write-review needs --sample, and --sample needs write-review', () => {
    expect(
      parseEvalArgs(['--label', 'a', '--write-review', '--sample', '40']),
    ).toMatchObject({ command: 'write-review', sample: 40 });
    expect(() => parseEvalArgs(['--label', 'a', '--write-review'])).toThrow(
      /--sample/,
    );
    expect(() => parseEvalArgs(['--label', 'a', '--sample', '40'])).toThrow(
      /only used with --write-review/,
    );
    expect(() =>
      parseEvalArgs(['--label', 'a', '--write-review', '--sample', '0']),
    ).toThrow(UsageError);
  });

  it('refuses to combine the commands', () => {
    expect(() =>
      parseEvalArgs(['--label', 'a', '--dry-run', '--report-only']),
    ).toThrow(/cannot be combined/);
    expect(() =>
      parseEvalArgs([
        '--label',
        'a',
        '--report-only',
        '--summarise-review',
        'x.md',
      ]),
    ).toThrow(/cannot be combined/);
  });

  it('rejects unknown flags and a missing value', () => {
    expect(() => parseEvalArgs(['--label', 'a', '--bogus'])).toThrow(
      UsageError,
    );
    expect(() => parseEvalArgs(['--label'])).toThrow(UsageError);
  });
});
