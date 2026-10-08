/** ASCII-only fallback for the quoted `filename` parameter (RFC 6266). */
export function asciiFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\r\n"\\]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .trim();
  return cleaned === '' ? 'cv.pdf' : cleaned;
}

/** Percent-encodes per RFC 5987 `attr-char` for the `filename*` parameter. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildContentDisposition(filename: string): string {
  // Strip control characters and quote/backslash from the original too.
  // eslint-disable-next-line no-control-regex
  const original = filename.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const ascii = asciiFilename(filename);
  if (original === '') return `inline; filename="${ascii}"`;
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(original)}`;
}
