import { citedUnitIds } from './cited-unit-ids.js';
import type { EvidenceUnit } from './evidence-units.js';

const units: EvidenceUnit[] = [
  { id: 'S1', source: 'cv', text: 'Jane Doe' },
  { id: 'S2', source: 'cv', text: 'Built Node.js services.' },
  { id: 'S3', source: 'cv', text: 'Led the Kafka migration.' },
  { id: 'G1', source: 'github', text: 'Led the Kafka migration.' },
];

describe('citedUnitIds', () => {
  it('maps quote texts to the ids of identical units in order', () => {
    expect(
      citedUnitIds([{ source: 'cv', text: units[2].text }], units),
    ).toEqual(['S3']);
    expect(
      citedUnitIds(
        [
          { source: 'cv', text: 'Led the Kafka migration.' },
          { source: 'cv', text: 'Built Node.js services.' },
        ],
        units,
      ),
    ).toEqual(['S3', 'S2']);
  });

  it('citedUnitIds returns [] when no quote matches a unit', () => {
    expect(
      citedUnitIds(
        [{ source: 'cv', text: 'A chunk of text segmented differently' }],
        units,
      ),
    ).toEqual([]);
  });

  it('matches github quotes against G units only', () => {
    expect(
      citedUnitIds(
        [{ source: 'github', text: 'Led the Kafka migration.' }],
        units,
      ),
    ).toEqual(['G1']);
  });

  it('lists an id once when two quotes resolve to it', () => {
    expect(
      citedUnitIds(
        [
          { source: 'cv', text: 'Jane Doe' },
          { source: 'cv', text: 'Jane Doe' },
        ],
        units,
      ),
    ).toEqual(['S1']);
  });
});
