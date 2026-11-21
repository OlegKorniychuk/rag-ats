import type { ScoreQuote } from '@rag-ats/shared';
import type { EvidenceUnit } from './evidence-units.js';

/**
 * Recovers the evidence-unit IDs a stored score cited, by matching each quote's
 * text to a unit of the same source with identical text. Segmentation is
 * deterministic, so a `full_text` score's quotes match exactly; a quote that
 * matches no unit (e.g. a `rag` score citing a chunk segmented differently) is
 * left out. IDs keep the quotes' order, without duplicates.
 */
export function citedUnitIds(
  quotes: readonly ScoreQuote[],
  units: readonly EvidenceUnit[],
): string[] {
  const ids: string[] = [];
  for (const quote of quotes) {
    const unit = units.find(
      (u) => u.source === quote.source && u.text === quote.text,
    );
    if (unit && !ids.includes(unit.id)) ids.push(unit.id);
  }
  return ids;
}
