import { delay, http, HttpResponse } from 'msw';
import type { GithubRepoResponse } from '../../src/github/github-client.js';

export const GITHUB_API = 'https://api.github.com';

export const GITHUB_USERNAME = 'janedoe';

export const GITHUB_USER_FIXTURE = {
  login: GITHUB_USERNAME,
  html_url: `https://github.com/${GITHUB_USERNAME}`,
  bio: 'Backend engineer. TypeScript and Go.',
};

function repo(
  overrides: Partial<GithubRepoResponse> & { name: string },
): GithubRepoResponse {
  return {
    html_url: `https://github.com/${GITHUB_USERNAME}/${overrides.name}`,
    description: `${overrides.name} description`,
    language: 'TypeScript',
    stargazers_count: 0,
    topics: [],
    pushed_at: '2025-01-01T00:00:00Z',
    fork: false,
    archived: false,
    ...overrides,
  };
}

/**
 * Owned repos, deliberately unordered. Expected selection (non-fork,
 * non-archived, stars desc then pushed desc, max 6):
 * charlie, bravo, alpha, delta, echo, foxtrot (golf and hotel are cut).
 * Expected languages (all non-fork, archived included): TypeScript 3,
 * Go 2, Python 2, Rust 1.
 */
export const GITHUB_REPOS_FIXTURE: GithubRepoResponse[] = [
  repo({
    name: 'hotel',
    language: 'Python',
    stargazers_count: 0,
    pushed_at: '2025-02-01T00:00:00Z',
  }),
  repo({
    name: 'forked-big',
    fork: true,
    stargazers_count: 9999,
    language: 'TypeScript',
  }),
  repo({
    name: 'alpha',
    stargazers_count: 50,
    pushed_at: '2026-03-01T00:00:00Z',
    topics: ['nestjs', 'api'],
  }),
  repo({
    name: 'archived-big',
    archived: true,
    stargazers_count: 5000,
    language: 'Go',
  }),
  repo({
    name: 'charlie',
    language: 'Python',
    stargazers_count: 200,
    pushed_at: '2024-06-01T00:00:00Z',
    description: null,
  }),
  repo({
    name: 'bravo',
    stargazers_count: 50,
    pushed_at: '2026-05-01T00:00:00Z',
  }),
  repo({
    name: 'echo',
    stargazers_count: 5,
    pushed_at: '2025-09-01T00:00:00Z',
  }),
  repo({
    name: 'delta',
    language: 'Go',
    stargazers_count: 10,
    pushed_at: '2025-08-01T00:00:00Z',
  }),
  repo({
    name: 'golf',
    language: null,
    stargazers_count: 1,
    pushed_at: '2025-07-01T00:00:00Z',
  }),
  repo({
    name: 'foxtrot',
    language: 'Rust',
    stargazers_count: 3,
    pushed_at: '2025-06-01T00:00:00Z',
  }),
];

/** Images, badges and HTML that must be stripped; the prose must survive. */
export const MESSY_README = `<h1 align="center">Charlie</h1>
<p align="center"><img src="https://example.com/logo.png" alt="logo"></p>

[![Build](https://img.shields.io/badge/build-passing.svg)](https://ci.example.com)
[![npm](https://img.shields.io/npm/v/charlie.svg)](https://npm.example.com)

![screenshot](https://example.com/shot.png)

<!-- hidden comment -->
<script>alert('x')</script>

Charlie is a   tiny\tPython library
for parsing CVs.


## Usage

Run \`charlie parse cv.pdf\`.
`;

export const MESSY_README_CLEANED =
  'Charlie Charlie is a tiny Python library for parsing CVs. ## Usage Run `charlie parse cv.pdf`.';

export const LONG_README = `Bravo handbook. ${'lorem ipsum '.repeat(500)}`;

/** README text per repo name; repos not listed here answer 404. */
export const GITHUB_READMES_FIXTURE: Record<string, string> = {
  charlie: MESSY_README,
  bravo: LONG_README,
};

export interface GithubHandlerOptions {
  user?: typeof GITHUB_USER_FIXTURE;
  repos?: GithubRepoResponse[];
  readmes?: Record<string, string>;
}

/** Happy-path handlers for one user (default: the fixtures above). */
export function githubHandlers(options: GithubHandlerOptions = {}) {
  const user = options.user ?? GITHUB_USER_FIXTURE;
  const repos = options.repos ?? GITHUB_REPOS_FIXTURE;
  const readmes = options.readmes ?? GITHUB_READMES_FIXTURE;
  return [
    http.get(`${GITHUB_API}/users/${user.login}`, () =>
      HttpResponse.json(user),
    ),
    http.get(`${GITHUB_API}/users/${user.login}/repos`, () =>
      HttpResponse.json(repos),
    ),
    http.get(`${GITHUB_API}/repos/${user.login}/:repo/readme`, ({ params }) => {
      const text = readmes[String(params.repo)];
      return text === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404 })
        : HttpResponse.text(text);
    }),
  ];
}

/** Default for suites that don't care about GitHub: every API call answers 404. */
export const githubCatchAllNotFoundHandler = () =>
  http.all(`${GITHUB_API}/*`, () =>
    HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
  );

/** Any user lookup answers 404. */
export const githubUserNotFoundHandler = () =>
  http.get(`${GITHUB_API}/users/:username`, () =>
    HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
  );

/** Primary rate limit: GitHub answers 403 with remaining = 0. */
export const githubRateLimitHandler = () =>
  http.get(`${GITHUB_API}/users/:username`, () =>
    HttpResponse.json(
      { message: 'API rate limit exceeded' },
      { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
    ),
  );

/** Secondary rate limit / abuse detection: 429. */
export const githubTooManyRequestsHandler = () =>
  http.get(`${GITHUB_API}/users/:username`, () =>
    HttpResponse.json(
      { message: 'Too Many Requests' },
      { status: 429, headers: { 'retry-after': '60' } },
    ),
  );

export const githubServerErrorHandler = () =>
  http.get(`${GITHUB_API}/users/:username`, () =>
    HttpResponse.json({ message: 'Server Error' }, { status: 500 }),
  );

/** Delays the user lookup (to exercise the client timeout). */
export const githubSlowUserHandler = (ms: number) =>
  http.get(`${GITHUB_API}/users/:username`, async () => {
    await delay(ms);
    return HttpResponse.json(GITHUB_USER_FIXTURE);
  });

export const githubNetworkErrorHandler = () =>
  http.get(`${GITHUB_API}/users/:username`, () => HttpResponse.error());

export const githubInvalidJsonHandler = () =>
  http.get(`${GITHUB_API}/users/:username`, () =>
    HttpResponse.text('<html>not json</html>', { status: 200 }),
  );

/**
 * Records every request to the GitHub API. Wire it with
 * `server.events.on('request:start', capture.listener)`.
 */
export function captureGithubRequests() {
  const requests: Array<{ path: string; search: string; headers: Headers }> =
    [];
  return {
    requests,
    listener: ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      if (url.origin !== GITHUB_API) return;
      requests.push({
        path: url.pathname,
        search: url.search,
        headers: new Headers(request.headers),
      });
    },
  };
}
