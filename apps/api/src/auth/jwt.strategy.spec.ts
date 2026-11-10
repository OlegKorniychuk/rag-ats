import { jest } from '@jest/globals';
import type { EnvConfig } from '../config/env.config.js';
import type {
  Recruiter,
  RecruitersRepository,
} from '../db/repositories/recruiters.repository.js';
import { JwtStrategy } from './jwt.strategy.js';

function makeStrategy(recruiter: Recruiter | null) {
  const findById = jest
    .fn<RecruitersRepository['findById']>()
    .mockResolvedValue(recruiter);
  const repository = { findById } as unknown as RecruitersRepository;
  const strategy = new JwtStrategy(
    { JWT_SECRET: 'test-secret' } as EnvConfig,
    repository,
  );
  return { strategy, findById };
}

describe('JwtStrategy', () => {
  it('returns the user from the DB row when the recruiter exists', async () => {
    const { strategy, findById } = makeStrategy({
      id: 'r1',
      email: 'db@example.com',
    } as Recruiter);

    const user = await strategy.validate({
      sub: 'r1',
      email: 'stale-token@example.com',
    });

    expect(findById).toHaveBeenCalledWith('r1');
    expect(user).toEqual({ id: 'r1', email: 'db@example.com' });
  });

  it('returns null when the recruiter no longer exists', async () => {
    const { strategy } = makeStrategy(null);

    await expect(
      strategy.validate({ sub: 'gone', email: 'gone@example.com' }),
    ).resolves.toBeNull();
  });
});
