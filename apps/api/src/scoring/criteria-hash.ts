import { createHash } from 'node:crypto';

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fingerprint of what a vacancy's criteria are extracted from: sha256 (hex) of
 * the title and requirements with whitespace collapsed, so cosmetic edits do
 * not invalidate cached criteria or existing scores.
 */
export function vacancyCriteriaHash(
  title: string,
  requirements: string,
): string {
  return createHash('sha256')
    .update(`${collapse(title)}\n${collapse(requirements)}`)
    .digest('hex');
}
