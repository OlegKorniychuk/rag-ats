import type { CvContent } from './cv-content.js';
import {
  bandQuotas,
  BORDERLINE_WEAK_MIN,
  cohenKappa,
  computeAgreement,
  confusionMatrix,
  emptyLabels,
  hasLabels,
  missingLabels,
  quadraticWeightedKappa,
  renderAgreementMarkdown,
  renderCvMarkdown,
  renderGithubMarkdown,
  sampleStratified,
  toSampleFile,
  type LabelEntry,
} from './spot-check.js';
import { loadDraftData } from './test-data.js';
import { BACKEND_UK, INJECTION_EN } from './test-cvs.js';
import type { Band, GroundTruthPair } from './types.js';

/** 3 vacancies x 40 personas; the band follows the persona number. */
function fakePairs(): GroundTruthPair[] {
  const pairs: GroundTruthPair[] = [];
  for (let p = 1; p <= 40; p++) {
    for (const v of ['a', 'b', 'c']) {
      const band: Band =
        (p + v.charCodeAt(0)) % 7 === 0
          ? 'strong'
          : (p + v.charCodeAt(0)) % 3 === 0
            ? 'partial'
            : 'weak';
      pairs.push({
        vacancyId: v,
        personaId: `p${String(p).padStart(3, '0')}`,
        score: band === 'strong' ? 90 : band === 'partial' ? 50 : 10,
        band,
        requirements: [],
      });
    }
  }
  return pairs;
}

describe('sampleStratified', () => {
  const pairs = fakePairs();
  const bandOf = (s: GroundTruthPair[], band: Band) =>
    s.filter((p) => p.band === band).length;

  it('splits the sample equally across the bands', () => {
    const sample = sampleStratified(pairs, 30, 1);
    expect(sample).toHaveLength(30);
    expect(bandOf(sample, 'strong')).toBe(10);
    expect(bandOf(sample, 'partial')).toBe(10);
    expect(bandOf(sample, 'weak')).toBe(10);
  });

  it('takes half of the weak pairs from the borderline range', () => {
    // every 4th persona's weak pairs are borderline (score 30)
    const mixed = pairs.map((p) =>
      p.band === 'weak' && Number(p.personaId.slice(1)) % 4 === 0
        ? { ...p, score: 30 }
        : p,
    );
    const weak = sampleStratified(mixed, 30, 1).filter(
      (p) => p.band === 'weak',
    );
    expect(weak).toHaveLength(10);
    expect(weak.filter((p) => p.score >= BORDERLINE_WEAK_MIN)).toHaveLength(5);
  });

  it('never repeats a persona and spreads over the vacancies', () => {
    const sample = sampleStratified(pairs, 30, 3);
    expect(new Set(sample.map((p) => p.personaId)).size).toBe(30);
    const perVacancy = ['a', 'b', 'c'].map(
      (v) => sample.filter((p) => p.vacancyId === v).length,
    );
    expect(
      Math.max(...perVacancy) - Math.min(...perVacancy),
    ).toBeLessThanOrEqual(1);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const key = (s: GroundTruthPair[]) =>
      s.map((p) => `${p.vacancyId}/${p.personaId}`).join(',');
    expect(key(sampleStratified(pairs, 30, 7))).toBe(
      key(sampleStratified(pairs, 30, 7)),
    );
    expect(key(sampleStratified(pairs, 30, 7))).not.toBe(
      key(sampleStratified(pairs, 30, 8)),
    );
  });

  it('shuffles, so the pair number does not reveal the band', () => {
    const sample = sampleStratified(pairs, 30, 5);
    const firstTen = sample.slice(0, 10).map((p) => p.band);
    expect(new Set(firstTen).size).toBeGreaterThan(1);
  });

  it('gives a short band share to the others', () => {
    const fewStrong = pairs.map((p, i) =>
      p.band === 'strong' && i % 2 === 0 ? { ...p, band: 'weak' as const } : p,
    );
    const strong = fewStrong.filter((p) => p.band === 'strong');
    const onlyThree = fewStrong.filter(
      (p) => p.band !== 'strong' || strong.indexOf(p) < 3,
    );
    const sample = sampleStratified(onlyThree, 30, 1);
    expect(sample).toHaveLength(30);
    expect(bandOf(sample, 'strong')).toBe(3);
  });

  it('returns fewer pairs when there are not enough distinct personas', () => {
    expect(sampleStratified(pairs, 100, 1)).toHaveLength(40);
  });

  it('computes quotas that sum to the size', () => {
    expect(bandQuotas(30)).toEqual({ strong: 10, partial: 10, weak: 10 });
    const q = bandQuotas(31);
    expect(q.strong + q.partial + q.weak).toBe(31);
  });
});

describe('labels file', () => {
  const sample = toSampleFile(sampleStratified(fakePairs(), 6, 1), 1);

  it('starts with null bands and empty notes, numbered from 1', () => {
    const labels = emptyLabels(sample);
    expect(labels.map((l) => l.pair)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(labels.every((l) => l.band === null && l.note === '')).toBe(true);
    expect(hasLabels(labels)).toBe(false);
  });

  it('detects filled labels and missing ones', () => {
    const labels = emptyLabels(sample);
    labels[2].band = 'weak';
    expect(hasLabels(labels)).toBe(true);
    expect(missingLabels(labels)).toEqual([1, 2, 4, 5, 6]);
    labels[0].band = 'good' as Band;
    expect(missingLabels(labels)).toContain(1);
  });

  it('keeps no band in the sample definition', () => {
    expect(JSON.stringify(sample)).not.toMatch(/band|score/);
  });
});

describe('Cohen kappa', () => {
  // Rows: rater A, columns: rater B, order strong / partial / weak.
  it('matches the textbook 2x2 example (kappa = 0.4)', () => {
    // 50 items, A: 25 yes / 25 no, B: 30 yes / 20 no, 20 + 15 agree.
    // "yes" is strong and "no" is weak; partial is unused.
    const twoByTwo = [
      [20, 0, 5],
      [0, 0, 0],
      [10, 0, 15],
    ];
    expect(cohenKappa(twoByTwo)).toBeCloseTo(0.4, 10);
    expect(quadraticWeightedKappa(twoByTwo)).toBeCloseTo(0.4, 10);
  });

  it('matches a hand-computed 3x3 example', () => {
    const m = [
      [10, 2, 0],
      [3, 8, 1],
      [0, 2, 4],
    ];
    // po = 22/30, pe = 330/900 -> (0.7333 - 0.3667) / 0.6333
    expect(cohenKappa(m)).toBeCloseTo(0.5789, 4);
    // 1 - 2.0 / 8.2
    expect(quadraticWeightedKappa(m)).toBeCloseTo(0.7561, 4);
  });

  it('is 1 for perfect agreement and 0 at chance level', () => {
    const perfect = [
      [5, 0, 0],
      [0, 7, 0],
      [0, 0, 3],
    ];
    expect(cohenKappa(perfect)).toBe(1);
    expect(quadraticWeightedKappa(perfect)).toBe(1);
    // Independent raters: expected counts exactly.
    const chance = [
      [4, 2, 2],
      [2, 1, 1],
      [2, 1, 1],
    ];
    expect(cohenKappa(chance)).toBeCloseTo(0, 10);
    expect(quadraticWeightedKappa(chance)).toBeCloseTo(0, 10);
  });

  it('handles raters that use a single band', () => {
    expect(
      cohenKappa([
        [9, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toBe(1);
    // A says strong always, B is mixed: no information, kappa 0.
    const oneSided = [
      [3, 3, 4],
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(cohenKappa(oneSided)).toBeCloseTo(0, 10);
    expect(
      cohenKappa([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toBeNaN();
  });

  it('is negative for systematic disagreement', () => {
    const m = [
      [0, 3, 3],
      [3, 0, 3],
      [3, 3, 0],
    ];
    expect(cohenKappa(m)).toBeCloseTo(-0.5, 10);
    expect(quadraticWeightedKappa(m)).toBeCloseTo(-0.5, 10);
  });

  it('penalises a far miss more than a near miss when weighted', () => {
    const near = [
      [8, 2, 0],
      [0, 10, 0],
      [0, 0, 10],
    ];
    const far = [
      [8, 0, 2],
      [0, 10, 0],
      [0, 0, 10],
    ];
    expect(cohenKappa(near)).toBeCloseTo(cohenKappa(far), 10);
    expect(quadraticWeightedKappa(near)).toBeGreaterThan(
      quadraticWeightedKappa(far),
    );
  });
});

describe('computeAgreement', () => {
  const truth: GroundTruthPair[] = [
    {
      vacancyId: 'v1',
      personaId: 'p1',
      score: 90,
      band: 'strong',
      requirements: [{ requirementId: 'r1', status: 'met', tag: 'java' }],
    },
    {
      vacancyId: 'v1',
      personaId: 'p2',
      score: 50,
      band: 'partial',
      requirements: [{ requirementId: 'r1', status: 'partial', tag: 'java' }],
    },
    {
      vacancyId: 'v1',
      personaId: 'p3',
      score: 10,
      band: 'weak',
      requirements: [{ requirementId: 'r1', status: 'not_met' }],
    },
    {
      vacancyId: 'v1',
      personaId: 'p4',
      score: 80,
      band: 'strong',
      requirements: [{ requirementId: 'r1', status: 'met', tag: 'java' }],
    },
  ];
  const vacancies = [
    {
      id: 'v1',
      title: 'T',
      intro: '',
      text: '',
      requirements: [
        {
          id: 'r1',
          text: 'Java experience',
          kind: 'must' as const,
          tags: ['java'],
        },
      ],
    },
  ];
  const label = (
    pair: number,
    p: string,
    band: Band,
    note = '',
  ): LabelEntry => ({
    pair,
    vacancyId: 'v1',
    personaId: p,
    band,
    note,
  });

  it('reports agreement, kappa, the matrix and the disagreements with statuses', () => {
    const labels = [
      label(1, 'p1', 'strong'),
      label(2, 'p2', 'weak', 'no depth'),
      label(3, 'p3', 'weak'),
      label(4, 'p4', 'partial'),
    ];
    const a = computeAgreement(labels, truth, vacancies);
    expect(a.exactAgreement).toBe(0.5);
    expect(a.confusion).toEqual([
      [1, 1, 0],
      [0, 0, 1],
      [0, 0, 1],
    ]);
    expect(a.disagreements.map((d) => d.pair)).toEqual([2, 4]);
    expect(a.disagreements[0]).toMatchObject({
      rule: 'partial',
      human: 'weak',
      score: 50,
      note: 'no depth',
    });
    expect(a.disagreements[0].requirements[0]).toMatchObject({
      requirementId: 'r1',
      status: 'partial',
      text: 'Java experience',
    });
    const md = renderAgreementMarkdown(a);
    expect(md).toContain('Exact band agreement: 50.0%');
    expect(md).toContain(
      'Rule: partial (score 50), Dude: weak. Note: no depth',
    );
    expect(md).toContain('r1: partial (java) - Java experience');
  });

  it('is perfect when every label equals the rule', () => {
    const labels = truth.map((t, i) => label(i + 1, t.personaId, t.band));
    const a = computeAgreement(labels, truth, vacancies);
    expect(a.exactAgreement).toBe(1);
    expect(a.kappa).toBe(1);
    expect(a.quadraticKappa).toBe(1);
    expect(renderAgreementMarkdown(a)).toContain('None.');
  });

  it('fails on a pair that is not in the ground truth', () => {
    expect(() =>
      computeAgreement([label(1, 'p9', 'weak')], truth, vacancies),
    ).toThrow(/not in ground-truth/);
  });

  it('builds the confusion matrix with the rule on the rows', () => {
    expect(
      confusionMatrix([
        { rule: 'strong', human: 'weak' },
        { rule: 'weak', human: 'strong' },
        { rule: 'weak', human: 'strong' },
      ]),
    ).toEqual([
      [0, 0, 1],
      [0, 0, 0],
      [2, 0, 0],
    ]);
  });
});

describe('plain text rendering', () => {
  it('renders a CV as readable text without the hidden injection', () => {
    const md = renderCvMarkdown(INJECTION_EN);
    expect(md).toContain('**Kwame Silva**');
    expect(md).toContain('Coastline Labs');
    expect(md).toContain('Feb 2023 – Present');
    expect(md).not.toContain('PWNED');
    expect(md).not.toContain('SYSTEM NOTE');
  });

  it('renders uk CVs with translated headings', () => {
    const md = renderCvMarkdown(BACKEND_UK as CvContent);
    expect(md).toContain('_Досвід роботи_');
    expect(md).toContain('вер. 2023 – дотепер');
  });

  it('renders the GitHub fixture with repos and a README excerpt', () => {
    const md = renderGithubMarkdown({
      user: { login: 'synth-x', bio: 'Builds  things' },
      repos: [
        {
          name: 'r1',
          description: 'A repo',
          language: 'Python',
          topics: ['ml'],
        },
        { name: 'r2', description: null, language: null },
      ],
      readmes: { r1: `# Title\n${'word '.repeat(100)}` },
    });
    expect(md).toContain('**GitHub: synth-x**');
    expect(md).toContain('Builds things');
    expect(md).toContain('- **r1** (Python, ml): A repo');
    expect(md).toContain('- **r2**');
    expect(md).toMatch(/README: Title word word.*\.\.\.$/m);
  });
});

it('uses the committed vacancy draft for the sample text', async () => {
  const { vacancies } = await loadDraftData();
  expect(vacancies.length).toBeGreaterThan(0);
});
