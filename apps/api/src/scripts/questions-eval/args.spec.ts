// cli.ts pulls in EnvConfig, whose decorators need the Reflect metadata polyfill.
import 'reflect-metadata';
import { UsageError } from '../shared/cli.js';
import { parseQuestionsEvalArgs, QUESTIONS_EVAL_DEFAULTS } from './args.js';

describe('parseQuestionsEvalArgs', () => {
  it('applies the defaults', () => {
    expect(parseQuestionsEvalArgs(['--label', 'q1'])).toEqual({
      label: 'q1',
      dryRun: false,
      maxUsd: QUESTIONS_EVAL_DEFAULTS.maxUsd,
      perBand: 10,
      review: 25,
      seed: 42,
      summariseReview: null,
    });
    expect(QUESTIONS_EVAL_DEFAULTS).toEqual({
      maxUsd: 1,
      perBand: 10,
      review: 25,
      seed: 42,
    });
  });

  it('reads --max-usd 0.5, --per-band, --review, --seed and --dry-run', () => {
    expect(
      parseQuestionsEvalArgs([
        '--label',
        'q2',
        '--max-usd',
        '0.5',
        '--per-band',
        '3',
        '--review',
        '5',
        '--seed',
        '7',
        '--dry-run',
      ]),
    ).toMatchObject({
      label: 'q2',
      maxUsd: 0.5,
      perBand: 3,
      review: 5,
      seed: 7,
      dryRun: true,
    });
  });

  it('requires --label unless summarising a review', () => {
    expect(() => parseQuestionsEvalArgs([])).toThrow(UsageError);
    expect(() => parseQuestionsEvalArgs(['--dry-run'])).toThrow(
      '--label is required',
    );
    expect(
      parseQuestionsEvalArgs(['--summarise-review', 'docs/x.review.md']),
    ).toMatchObject({ label: null, summariseReview: 'docs/x.review.md' });
  });

  it('rejects a bad label and bad numbers', () => {
    expect(() => parseQuestionsEvalArgs(['--label', '../x'])).toThrow(
      UsageError,
    );
    expect(() =>
      parseQuestionsEvalArgs(['--label', 'q', '--per-band', '0']),
    ).toThrow(UsageError);
    expect(() =>
      parseQuestionsEvalArgs(['--label', 'q', '--max-usd', '-1']),
    ).toThrow(UsageError);
  });
});
