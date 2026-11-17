import type { BandCounts } from './ground-truth.js';
import type { SearchQuery } from './types.js';

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join('  ');
  return [
    line(headers),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

export function formatBandTable(distribution: Map<string, BandCounts>): string {
  const rows = [...distribution].map(([id, c]) => [
    id,
    String(c.strong),
    String(c.partial),
    String(c.weak),
  ]);
  const sum = (key: keyof BandCounts) =>
    String([...distribution.values()].reduce((a, c) => a + c[key], 0));
  rows.push(['total', sum('strong'), sum('partial'), sum('weak')]);
  return table(['vacancy', 'strong', 'partial', 'weak'], rows);
}

export function formatQueryTable(queries: SearchQuery[]): string {
  return table(
    ['query', 'relevant', 'partial'],
    queries.map((q) => [
      q.id,
      String(q.relevant?.length ?? 0),
      String(q.partiallyRelevant?.length ?? 0),
    ]),
  );
}
