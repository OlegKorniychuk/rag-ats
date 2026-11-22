// cli.ts pulls in EnvConfig, whose decorators need the Reflect metadata polyfill.
import 'reflect-metadata';
import { UsageError } from '../shared/cli.js';
import { assertExperimentDb, parseReindexArgs } from './args.js';

describe('parseReindexArgs', () => {
  it('requires --chunk-max-chars', () => {
    expect(() => parseReindexArgs([])).toThrow(UsageError);
  });

  it('parses the flags with defaults', () => {
    expect(parseReindexArgs(['--chunk-max-chars', '500'])).toEqual({
      cvMaxChars: 500,
      dryRun: false,
      maxUsd: 0.1,
    });
    expect(
      parseReindexArgs([
        '--chunk-max-chars=2000',
        '--dry-run',
        '--max-usd',
        '0.5',
      ]),
    ).toEqual({ cvMaxChars: 2000, dryRun: true, maxUsd: 0.5 });
  });

  it.each(['199', '0', '-5', '500.5', 'abc', ''])(
    'rejects --chunk-max-chars=%s',
    (raw) => {
      expect(() => parseReindexArgs([`--chunk-max-chars=${raw}`])).toThrow(
        /--chunk-max-chars/,
      );
    },
  );

  it.each(['0', '-1', 'x'])('rejects --max-usd=%s', (raw) => {
    expect(() =>
      parseReindexArgs(['--chunk-max-chars=500', `--max-usd=${raw}`]),
    ).toThrow(/--max-usd/);
  });

  it('rejects unknown flags', () => {
    expect(() =>
      parseReindexArgs(['--chunk-max-chars=500', '--force']),
    ).toThrow(UsageError);
  });
});

describe('assertExperimentDb', () => {
  const base = 'postgres://rag_ats:rag_ats@localhost:5432/';

  it.each([
    'rag_ats',
    'rag_ats_seed',
    'rag_ats_seed?sslmode=disable',
    'rag_ats_seed/',
    'other',
    'rag_ats_exp_',
    'rag%5Fats%5Fseed',
    '',
  ])('refuses %s', (db) => {
    expect(() => assertExperimentDb(`${base}${db}`)).toThrow(UsageError);
  });

  it('refuses a URL that does not parse', () => {
    expect(() => assertExperimentDb('not a url')).toThrow(UsageError);
  });

  it.each([
    ['rag_ats_exp_large_500', 'rag_ats_exp_large_500'],
    ['rag_ats_exp_small_2000?x=1', 'rag_ats_exp_small_2000'],
    ['rag%5Fats%5Fexp%5Flarge%5F1000', 'rag_ats_exp_large_1000'],
  ])('accepts %s', (db, name) => {
    expect(assertExperimentDb(`${base}${db}`)).toBe(name);
  });
});
