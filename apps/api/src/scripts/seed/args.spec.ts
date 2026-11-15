// cli.ts pulls in EnvConfig, whose decorators need the Reflect metadata polyfill.
import 'reflect-metadata';
import { UsageError } from '../shared/cli.js';
import { parseSeedArgs } from './args.js';

describe('parseSeedArgs', () => {
  it('applies the defaults', () => {
    expect(parseSeedArgs(['--label', 'run1'])).toEqual({
      label: 'run1',
      dryRun: false,
      maxUsd: 3,
      only: null,
      dir: 'data/synthetic',
      vacancies: null,
      timeoutMin: 30,
      concurrency: 4,
    });
  });

  it('reads every flag', () => {
    expect(
      parseSeedArgs([
        '--label',
        'smoke',
        '--max-usd',
        '0.5',
        '--only',
        'p001, p002',
        '--dir',
        'tmp/x',
        '--vacancies',
        'tmp/v.json',
        '--timeout-min',
        '5',
        '--concurrency',
        '2',
      ]),
    ).toMatchObject({
      label: 'smoke',
      maxUsd: 0.5,
      only: ['p001', 'p002'],
      dir: 'tmp/x',
      vacancies: 'tmp/v.json',
      timeoutMin: 5,
      concurrency: 2,
    });
  });

  it('needs a label unless --dry-run', () => {
    expect(() => parseSeedArgs([])).toThrow(UsageError);
    expect(parseSeedArgs(['--dry-run']).label).toBeNull();
  });

  it('rejects a bad label, number, or unknown flag', () => {
    expect(() => parseSeedArgs(['--label', '../x'])).toThrow(UsageError);
    expect(() => parseSeedArgs(['--label', 'a', '--max-usd', 'x'])).toThrow(
      UsageError,
    );
    expect(() => parseSeedArgs(['--label', 'a', '--concurrency', '0'])).toThrow(
      UsageError,
    );
    expect(() => parseSeedArgs(['--label', 'a', '--timeout-min', '0'])).toThrow(
      UsageError,
    );
    expect(() => parseSeedArgs(['--label', 'a', '--nope'])).toThrow(UsageError);
    expect(() => parseSeedArgs(['--label', 'a', '--only', ' , '])).toThrow(
      UsageError,
    );
  });
});
