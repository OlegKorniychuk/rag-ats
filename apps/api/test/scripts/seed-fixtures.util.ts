import type { EnvConfig } from '../../src/config/env.config.js';
import type { GithubFixture } from '../../src/github/fixture-github-client.js';
import type {
  PersonaSpec,
  VacancySpec,
} from '../../src/scripts/synth/types.js';

/** Small synthetic-set builders shared by the seed and eval integration tests. */

export const GITHUB_USERNAME = 'seed-jane';
export const GITHUB_FIXTURE: GithubFixture = {
  user: {
    login: GITHUB_USERNAME,
    html_url: `https://github.com/${GITHUB_USERNAME}`,
    bio: 'Seed fixture bio about Rust services.',
  },
  repos: [
    {
      name: 'seed-repo',
      html_url: `https://github.com/${GITHUB_USERNAME}/seed-repo`,
      description: 'A seed fixture repo',
      language: 'Rust',
      stargazers_count: 7,
      topics: ['rust'],
      pushed_at: '2026-01-01T00:00:00Z',
      fork: false,
      archived: false,
    },
  ],
  readmes: { 'seed-repo': 'Seed fixture README.' },
};

export const vacancy = (id: string): VacancySpec => ({
  id,
  title: `Seed vacancy ${id}`,
  intro: '',
  requirements: [],
  text: `- 3+ years of ${id}\n- Good communication`,
});

export const persona = (
  id: string,
  applyTo: string[],
  github: string | null = null,
): PersonaSpec => ({
  id,
  name: `Persona ${id}`,
  email: `${id}@example.com`,
  language: 'en',
  layout: '1-col',
  roles: [],
  projects: [],
  skills: [],
  github: github ? { username: github } : null,
  kind: 'targeted',
  flags: [],
  applyTo,
});

/** The validated env of a test context, reading GitHub profiles from `githubFixturesDir`. */
export const testEnv = (githubFixturesDir: string): EnvConfig =>
  ({
    DATABASE_URL: 'postgres://unused',
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '1h',
    PORT: 0,
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:5173',
    OPENAI_API_KEY: 'sk-test-dummy',
    OPENAI_MODEL: 'gpt-5.4-mini',
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    SCORING_MODE: 'full_text',
    JOBS_POLL_INTERVAL_SECONDS: 0.5,
    GITHUB_FIXTURES_DIR: githubFixturesDir,
  }) as EnvConfig;
