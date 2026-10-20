import { parseGithubUsername } from './github-username.js';

describe('parseGithubUsername', () => {
  it.each([
    ['https://github.com/octocat', 'octocat'],
    ['https://github.com/octocat/', 'octocat'],
    ['https://github.com/octocat/hello-world', 'octocat'],
    ['https://github.com/octocat/hello-world/issues/1', 'octocat'],
    ['https://github.com/octocat?tab=repositories', 'octocat'],
    ['https://github.com/octocat#readme', 'octocat'],
    ['https://www.github.com/octocat', 'octocat'],
    ['https://GitHub.COM/Octo-Cat', 'Octo-Cat'],
    ['  https://github.com/octocat  ', 'octocat'],
    ['https://github.com/a', 'a'],
    ['https://github.com/' + 'a'.repeat(39), 'a'.repeat(39)],
  ])('accepts %s', (url, expected) => {
    expect(parseGithubUsername(url)).toBe(expected);
  });

  it.each([
    ['http scheme', 'http://github.com/octocat'],
    ['other scheme', 'ftp://github.com/octocat'],
    ['gitlab', 'https://gitlab.com/octocat'],
    ['gist subdomain', 'https://gist.github.com/octocat'],
    ['api subdomain', 'https://api.github.com/users/octocat'],
    ['lookalike suffix', 'https://github.com.evil.com/octocat'],
    ['lookalike prefix', 'https://evilgithub.com/octocat'],
    ['userinfo trick', 'https://github.com@evil.com/octocat'],
    ['explicit port', 'https://github.com:8443/octocat'],
    ['no path', 'https://github.com'],
    ['root path', 'https://github.com/'],
    ['underscore', 'https://github.com/octo_cat'],
    ['dot', 'https://github.com/octo.cat'],
    ['encoded slash', 'https://github.com/octo%2Fcat'],
    ['space', 'https://github.com/octo cat'],
    ['leading hyphen', 'https://github.com/-octocat'],
    ['40 chars', 'https://github.com/' + 'a'.repeat(40)],
    ['empty string', ''],
    ['garbage', 'not a url'],
    ['host only without scheme', 'github.com/octocat'],
  ])('rejects %s', (_label, url) => {
    expect(parseGithubUsername(url)).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(parseGithubUsername(null)).toBeNull();
    expect(parseGithubUsername(undefined)).toBeNull();
  });
});
