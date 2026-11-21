import type { Band } from '../synth/types.js';
import { question, threeRecords } from './test-fixture.js';
import type { QuestionsRecord } from './metrics.js';
import {
  buildQuestionsReview,
  QuestionsReviewError,
  summariseQuestionsReview,
} from './review.js';

function manyRecords(): QuestionsRecord[] {
  const bands: Band[] = ['strong', 'partial', 'weak'];
  return bands.flatMap((band) =>
    Array.from({ length: 4 }, (_, i) => ({
      ...threeRecords()[0],
      item: {
        applicationId: `${band}-${i}`,
        vacancySpecId: 'v1',
        personaId: `p${i}`,
        band,
      },
      questions: Array.from({ length: 4 }, (_, q) =>
        question({ text: `${band} ${i} question ${q} | piped\nline` }),
      ),
    })),
  );
}

const rowsOf = (markdown: string) =>
  markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line));

describe('buildQuestionsReview', () => {
  it('has 25 rows sampled across bands with empty label cells', () => {
    const markdown = buildQuestionsReview(manyRecords(), 25, 42);
    const rows = rowsOf(markdown);

    expect(markdown).toContain(
      '| # | band | vacancy | candidate | criterion (score) | basis | question | purpose | quotes | grounded (yes/partly/no) | useful (yes/no) |',
    );
    expect(rows).toHaveLength(25);
    for (const band of ['strong', 'partial', 'weak']) {
      const n = rows.filter((r) => r.includes(`| ${band} |`)).length;
      expect(n).toBeGreaterThanOrEqual(8);
    }
    for (const row of rows) expect(row.endsWith('|  |  |')).toBe(true);
    expect(markdown).toContain('question 0 \\| piped line');
  });

  it('is deterministic per seed and skips failed records', () => {
    expect(buildQuestionsReview(manyRecords(), 25, 42)).toBe(
      buildQuestionsReview(manyRecords(), 25, 42),
    );
    const rows = rowsOf(buildQuestionsReview(threeRecords(), 25, 1));
    expect(rows).toHaveLength(6);
    expect(rows.some((r) => r.includes('| partial |'))).toBe(false);
  });

  it('identifies the candidate (persona and application) on every row', () => {
    const row = rowsOf(buildQuestionsReview([threeRecords()[0]], 1, 1))[0];
    expect(row).toContain('| v1 | p1 (a1) |');
  });

  it('shows the criterion score and the quotes with their source', () => {
    const row = rowsOf(buildQuestionsReview([threeRecords()[0]], 1, 1))[0];
    expect(row).toMatch(
      /\| (Kafka \(90\)|Postgres \(80\)|Kubernetes \(20\)) \|/,
    );
  });
});

describe('summariseQuestionsReview', () => {
  it('counts a labelled fixture', () => {
    const markdown = [
      '| # | band | vacancy | candidate | criterion (score) | basis | question | purpose | quotes | grounded (yes/partly/no) | useful (yes/no) |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | strong | v1 | p1 | Kafka (90) | fact | Q | P | cv: x | yes | yes |',
      '| 2 | strong | v1 | p1 | Kafka (90) | fact | Q | P | cv: x | Partly | no |',
      '| 3 | weak | v1 | p1 | Kafka (10) | gap | Q | P |  | no | Yes |',
      '| 4 | weak | v1 | p1 | Kafka (10) | gap | Q | P |  |  |  |',
    ].join('\n');

    expect(summariseQuestionsReview(markdown)).toEqual({
      labelled: 3,
      grounded: { yes: 1, partly: 1, no: 1 },
      useful: { yes: 2, no: 1 },
    });
  });

  it('rejects an unknown label with its row number', () => {
    const markdown = [
      '| # | band | vacancy | candidate | criterion (score) | basis | question | purpose | quotes | grounded (yes/partly/no) | useful (yes/no) |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 7 | strong | v1 | p1 | Kafka (90) | fact | Q | P | cv: x | maybe | yes |',
    ].join('\n');
    expect(() => summariseQuestionsReview(markdown)).toThrow(
      QuestionsReviewError,
    );
    expect(() => summariseQuestionsReview(markdown)).toThrow('row 7');
  });
});
