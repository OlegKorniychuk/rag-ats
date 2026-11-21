/**
 * G4 mapper: which of a vacancy's scorer criteria speak about a taxonomy tag?
 * The scorer's criteria are LLM-extracted prose, not the rule's requirements,
 * so the link is made through the tag's aliases, with the same word-boundary
 * and case rules as the ground-truth rule (`synth/aliases.ts`).
 */
import { findTags } from '../synth/aliases.js';
import type { Taxonomy } from '../synth/types.js';

/**
 * The criteria whose text mentions `tag` (any of its aliases), in the given
 * order. A criterion is tech text by construction, so an ambiguous alias
 * (`Go`, `R`, `Spring`) counts without a sentence cue, still case-sensitively.
 * Empty when the tag is unknown, an experience tag (no aliases), or nothing
 * mentions it: the caller counts that pair apart.
 */
export function criteriaMentioningTag<T extends { text: string }>(
  criteria: readonly T[],
  tag: string,
  taxonomy: Taxonomy,
): T[] {
  return criteria.filter((criterion) =>
    findTags(criterion.text, taxonomy, { assumeTechContext: true }).has(tag),
  );
}
