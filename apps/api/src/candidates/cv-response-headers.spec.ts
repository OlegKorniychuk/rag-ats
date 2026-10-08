import {
  asciiFilename,
  buildContentDisposition,
} from './cv-response-headers.js';

describe('cv response headers', () => {
  it('keeps a plain filename', () => {
    expect(buildContentDisposition('cv.pdf')).toBe(
      'inline; filename="cv.pdf"; filename*=UTF-8\'\'cv.pdf',
    );
  });

  it('strips quotes, backslashes and newlines from the ASCII fallback', () => {
    expect(asciiFilename('a"b\\c\r\nd.pdf')).toBe('abcd.pdf');
    const header = buildContentDisposition('a"b\r\nd.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="abd.pdf"');
  });

  it('replaces non-ASCII in the fallback and percent-encodes the original', () => {
    expect(buildContentDisposition('résumé.pdf')).toBe(
      'inline; filename="r_sum_.pdf"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.pdf',
    );
  });

  it('percent-encodes RFC 5987 reserved characters', () => {
    expect(buildContentDisposition("a'(b)*.pdf")).toContain(
      "filename*=UTF-8''a%27%28b%29%2A.pdf",
    );
  });

  it('falls back to cv.pdf for empty or fully-stripped names', () => {
    expect(buildContentDisposition('')).toBe('inline; filename="cv.pdf"');
    expect(asciiFilename('""\r\n')).toBe('cv.pdf');
  });
});
