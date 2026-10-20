const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * Extracts the GitHub username from a profile URL. Strict on purpose: only
 * `https://(www.)github.com/<user>[/...]` is accepted (http, other hosts such
 * as `gist.github.com`, ports and malformed values yield null). The result is
 * only ever interpolated into paths on the fixed `api.github.com` host.
 */
export function parseGithubUsername(
  url: string | null | undefined,
): string | null {
  if (typeof url !== 'string') return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  // The WHATWG parser lowercases the host and drops the default port.
  if (parsed.protocol !== 'https:') return null;
  if (!GITHUB_HOSTS.has(parsed.hostname) || parsed.port !== '') return null;

  const [, firstSegment] = parsed.pathname.split('/');
  if (firstSegment === undefined || !USERNAME_PATTERN.test(firstSegment)) {
    return null;
  }
  return firstSegment;
}
