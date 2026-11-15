import { extractDir } from './args.js';

describe('extractDir', () => {
  it('leaves argv alone without --dir', () => {
    expect(extractDir(['--seed', '3', '--force'])).toEqual({
      dir: undefined,
      args: ['--seed', '3', '--force'],
    });
  });

  it('removes --dir <path> wherever it appears', () => {
    expect(extractDir(['--dir', 'tmp/x', '--seed', '3'])).toEqual({
      dir: 'tmp/x',
      args: ['--seed', '3'],
    });
    expect(extractDir(['--seed', '3', '--dir', 'tmp/x', '--force'])).toEqual({
      dir: 'tmp/x',
      args: ['--seed', '3', '--force'],
    });
  });

  it('supports --dir=<path>', () => {
    expect(extractDir(['--dir=tmp/x', '--force'])).toEqual({
      dir: 'tmp/x',
      args: ['--force'],
    });
  });
});
