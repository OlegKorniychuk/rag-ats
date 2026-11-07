import { countRequirements } from './dry-run.js';

describe('countRequirements', () => {
  it('counts bullet lines only', () => {
    expect(
      countRequirements(
        'Intro line.\n\nMust have:\n- one\n- two (a, b)\n\nNice to have:\n  * three\n-\nend',
      ),
    ).toBe(3);
  });
});
