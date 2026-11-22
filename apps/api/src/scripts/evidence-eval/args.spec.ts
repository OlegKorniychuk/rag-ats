// cli.ts pulls in EnvConfig, whose decorators need the Reflect metadata polyfill.
import 'reflect-metadata';
import { UsageError } from '../shared/cli.js';
import { parseEvidenceEvalArgs } from './args.js';

describe('parseEvidenceEvalArgs', () => {
  it('parses the flags with defaults', () => {
    expect(parseEvidenceEvalArgs(['--label', 'small-500'])).toEqual({
      label: 'small-500',
      citationsFrom: 'baseline-units',
      dryRun: false,
      maxUsd: 0.05,
    });
    expect(
      parseEvidenceEvalArgs([
        '--dry-run',
        '--citations-from=other',
        '--max-usd=0.2',
      ]),
    ).toEqual({
      label: null,
      citationsFrom: 'other',
      dryRun: true,
      maxUsd: 0.2,
    });
  });

  it('requires --label unless --dry-run', () => {
    expect(() => parseEvidenceEvalArgs([])).toThrow(/--label/);
  });

  it.each(['../x', 'a/b', ''])('rejects the label %p', (label) => {
    expect(() => parseEvidenceEvalArgs([`--label=${label}`])).toThrow(
      UsageError,
    );
  });

  it('rejects a bad --citations-from', () => {
    expect(() =>
      parseEvidenceEvalArgs(['--label=x', '--citations-from=../etc']),
    ).toThrow(/--citations-from/);
  });

  it.each(['0', '-1', 'x'])('rejects --max-usd=%s', (raw) => {
    expect(() =>
      parseEvidenceEvalArgs(['--label=x', `--max-usd=${raw}`]),
    ).toThrow(/--max-usd/);
  });

  it('rejects unknown flags', () => {
    expect(() => parseEvidenceEvalArgs(['--label=x', '--k=3'])).toThrow(
      UsageError,
    );
  });
});
