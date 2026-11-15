import { jest } from '@jest/globals';
import { Global, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EnvConfig } from '../config/env.config.js';
import { FixtureGithubClient } from './fixture-github-client.js';
import { GithubClient } from './github-client.js';
import { GithubModule } from './github.module.js';

async function resolveClient(config: Partial<EnvConfig>) {
  @Global()
  @Module({
    providers: [{ provide: EnvConfig, useValue: config }],
    exports: [EnvConfig],
  })
  class TestConfigModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestConfigModule, GithubModule],
  }).compile();
  return moduleRef.get(GithubClient);
}

describe('GithubModule client selection', () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('provides the real client when GITHUB_FIXTURES_DIR is unset', async () => {
    const client = await resolveClient({ NODE_ENV: 'development' });
    expect(client).toBeInstanceOf(GithubClient);
    expect(client).not.toBeInstanceOf(FixtureGithubClient);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats an empty GITHUB_FIXTURES_DIR as unset', async () => {
    const client = await resolveClient({
      NODE_ENV: 'production',
      GITHUB_FIXTURES_DIR: '  ',
    });
    expect(client).not.toBeInstanceOf(FixtureGithubClient);
  });

  it('provides the fixture client and warns once when GITHUB_FIXTURES_DIR is set', async () => {
    const client = await resolveClient({
      NODE_ENV: 'development',
      GITHUB_FIXTURES_DIR: '/tmp/fixtures',
    });
    expect(client).toBeInstanceOf(FixtureGithubClient);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('/tmp/fixtures');
  });

  it('refuses to boot with GITHUB_FIXTURES_DIR in production', async () => {
    await expect(
      resolveClient({
        NODE_ENV: 'production',
        GITHUB_FIXTURES_DIR: '/tmp/fixtures',
      }),
    ).rejects.toThrow(/GITHUB_FIXTURES_DIR.*production/);
  });
});
