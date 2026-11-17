/**
 * Pure logic of `synth spot-check`: a blind stratified sample of ground-truth
 * pairs for Dude to label by hand, and the agreement statistics between his
 * bands and the rule's bands.
 */
import type { CvContent } from './cv-content.js';
import { formatPeriod, HEADINGS, rolesNewestFirst } from './render-html.js';
import { createRng } from './rng.js';
import type {
  Band,
  GroundTruthPair,
  RequirementStatus,
  VacancySpec,
} from './types.js';
import { renderVacancyText } from './vacancies.js';

export const BANDS: readonly Band[] = ['strong', 'partial', 'weak'];

/** One line of the sample definition (`sample.json`). No band, on purpose. */
export interface SamplePair {
  pair: number;
  vacancyId: string;
  personaId: string;
}

export interface SampleFile {
  seed: number;
  pairs: SamplePair[];
}

/** One line of `labels.json`; Dude fills `band` and may add a `note`. */
export interface LabelEntry extends SamplePair {
  band: Band | null;
  note: string;
}

/** How many pairs each band gets: equal shares, the remainder to partial first. */
export function bandQuotas(size: number): Record<Band, number> {
  const base = Math.floor(size / 3);
  const rest = size - 3 * base;
  return {
    partial: base + (rest > 0 ? 1 : 0),
    strong: base + (rest > 1 ? 1 : 0),
    weak: base,
  };
}

/** Weak pairs at or above this score are "borderline" for the sample. */
export const BORDERLINE_WEAK_MIN = 20;

/**
 * Stratified sample: equal shares per band (a short band hands its quota to
 * the others), never two pairs of the same persona, and pairs spread over the
 * vacancies (always draws from the least-used vacancy). Deterministic for a
 * seed. Returned in a shuffled order so the band cannot be guessed from the
 * pair number.
 *
 * Every other weak draw prefers a borderline pair (score >= 20): most weak
 * pairs are clear zero-fits, and a sample of only those would inflate
 * agreement.
 */
export function sampleStratified(
  pairs: readonly GroundTruthPair[],
  size: number,
  seed: number,
): GroundTruthPair[] {
  const rng = createRng(seed);
  const usedPersonas = new Set<string>();
  const vacancyUse = new Map<string, number>();
  const picked: GroundTruthPair[] = [];

  const draw = (band: Band, borderline = false): boolean => {
    const open = pairs.filter(
      (p) => p.band === band && !usedPersonas.has(p.personaId),
    );
    const near = borderline
      ? open.filter((p) => p.score >= BORDERLINE_WEAK_MIN)
      : [];
    const candidates = near.length > 0 ? near : open;
    if (candidates.length === 0) return false;
    const least = Math.min(
      ...candidates.map((p) => vacancyUse.get(p.vacancyId) ?? 0),
    );
    const pool = candidates.filter(
      (p) => (vacancyUse.get(p.vacancyId) ?? 0) === least,
    );
    const choice = rng.pick(pool);
    picked.push(choice);
    usedPersonas.add(choice.personaId);
    vacancyUse.set(choice.vacancyId, least + 1);
    return true;
  };

  const quotas = bandQuotas(size);
  for (const band of BANDS) {
    for (let i = 0; i < quotas[band]; i++) {
      draw(band, band === 'weak' && i % 2 === 0);
    }
  }
  // A band that ran dry leaves a shortfall: fill it from the other bands.
  let progress = true;
  while (picked.length < size && progress) {
    progress = false;
    for (const band of BANDS) {
      if (picked.length < size && draw(band)) progress = true;
    }
  }
  return rng.shuffle(picked);
}

export function toSampleFile(
  sample: readonly GroundTruthPair[],
  seed: number,
): SampleFile {
  return {
    seed,
    pairs: sample.map((p, i) => ({
      pair: i + 1,
      vacancyId: p.vacancyId,
      personaId: p.personaId,
    })),
  };
}

export const emptyLabels = (sample: SampleFile): LabelEntry[] =>
  sample.pairs.map((p) => ({ ...p, band: null, note: '' }));

/** True when a labels file already holds any of Dude's work. */
export const hasLabels = (labels: readonly LabelEntry[]): boolean =>
  labels.some((l) => l.band !== null || (l.note ?? '').trim() !== '');

/** Pairs whose band is missing or not one of the three bands. */
export function missingLabels(labels: readonly LabelEntry[]): number[] {
  return labels
    .filter((l) => !BANDS.includes(l.band as Band))
    .map((l) => l.pair);
}

// --- Plain-text rendering (blind) -------------------------------------------

const inline = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The CV as readable Markdown. The hidden injection text is left out: a human reading the PDF never sees it. */
export function renderCvMarkdown(cv: CvContent): string {
  const h = HEADINGS[cv.language];
  const out: string[] = [
    `**${cv.name}**, ${cv.headline}`,
    [cv.email, cv.location, cv.githubUrl].filter(Boolean).join(' | '),
  ];
  if (cv.summary) out.push('', `_${h.summary}_`, cv.summary);
  if (cv.roles.length > 0) {
    out.push('', `_${h.experience}_`);
    for (const role of rolesNewestFirst(cv.roles)) {
      out.push(
        `- **${role.title}**, ${role.employer} (${formatPeriod(role.start, role.end, cv.language)})`,
        ...role.bullets.map((b) => `  - ${b}`),
      );
    }
  }
  if (cv.projects.length > 0) {
    out.push('', `_${h.projects}_`);
    for (const p of cv.projects) out.push(`- **${p.name}**: ${p.description}`);
  }
  if (cv.skills.length > 0) {
    out.push('', `_${h.skills}_`, cv.skills.join(', '));
  }
  if (cv.education.length > 0) {
    out.push('', `_${h.education}_`);
    for (const ed of cv.education) {
      out.push(`- ${ed.degree}, ${ed.school} (${ed.end})`);
    }
  }
  if (cv.spokenLanguages.length > 0) {
    out.push('', `_${h.languages}_`, cv.spokenLanguages.join(', '));
  }
  return out.join('\n');
}

/** The subset of a `github/<username>.json` fixture the sample shows. */
export interface GithubFixtureView {
  user: { login: string; bio: string | null };
  repos: Array<{
    name: string;
    description: string | null;
    language: string | null;
    topics?: string[];
    fork?: boolean;
  }>;
  readmes?: Record<string, string>;
}

const README_EXCERPT = 240;

export function renderGithubMarkdown(fixture: GithubFixtureView): string {
  const out = [`**GitHub: ${fixture.user.login}**`];
  if (fixture.user.bio) out.push(inline(fixture.user.bio));
  for (const repo of fixture.repos) {
    const meta = [repo.language, ...(repo.topics ?? [])].filter(Boolean);
    out.push(
      `- **${repo.name}**${meta.length > 0 ? ` (${meta.join(', ')})` : ''}${repo.description ? `: ${inline(repo.description)}` : ''}`,
    );
    const readme = fixture.readmes?.[repo.name];
    if (readme) {
      const flat = inline(readme.replace(/[#*_`>]/g, ''));
      out.push(
        `  - README: ${flat.length > README_EXCERPT ? `${flat.slice(0, README_EXCERPT)}...` : flat}`,
      );
    }
  }
  return out.join('\n');
}

export interface SampleEntry {
  pair: number;
  vacancy: VacancySpec;
  cv: CvContent;
  /** Path of the PDF, relative to `sample.md`. */
  pdfPath: string;
  github: GithubFixtureView | null;
}

export function renderSampleMarkdown(
  entries: readonly SampleEntry[],
  seed: number,
): string {
  const out = [
    `# Spot-check sample (${entries.length} pairs, seed ${seed})`,
    '',
    'For each pair, judge how well the candidate fits the vacancy and write `strong`, `partial` or `weak` as `band` in `labels.json` (optionally a `note`). Judge from the vacancy and the CV, like a recruiter would.',
  ];
  for (const e of entries) {
    out.push(
      '',
      '---',
      '',
      `## Pair ${e.pair}`,
      '',
      '### Vacancy',
      '',
      renderVacancyText(e.vacancy).trim(),
      '',
      '### Candidate',
      '',
      renderCvMarkdown(e.cv),
      '',
      `PDF: ${e.pdfPath}`,
    );
    if (e.github) out.push('', renderGithubMarkdown(e.github));
  }
  return `${out.join('\n')}\n`;
}

// --- Agreement ---------------------------------------------------------------

/** matrix[rule][human] counts, rows and columns in BANDS order. */
export type ConfusionMatrix = number[][];

export function confusionMatrix(
  pairs: ReadonlyArray<{ rule: Band; human: Band }>,
): ConfusionMatrix {
  const m = BANDS.map(() => BANDS.map(() => 0));
  for (const { rule, human } of pairs) {
    m[BANDS.indexOf(rule)][BANDS.indexOf(human)]++;
  }
  return m;
}

/**
 * Cohen's kappa with weights w(i, j): 1 - sum(w O) / sum(w E), where O is the
 * observed and E the chance-expected count. Disagreement weights are 0 on the
 * diagonal, so w = 1 off the diagonal gives the unweighted kappa and
 * ((i - j) / (k - 1))^2 the quadratic one. When chance agreement is already
 * perfect (both raters used a single, same band) kappa is undefined; 1 is
 * returned for perfect agreement.
 */
function weightedKappa(
  m: ConfusionMatrix,
  weight: (i: number, j: number) => number,
): number {
  const k = m.length;
  const n = m.flat().reduce((a, b) => a + b, 0);
  if (n === 0) return Number.NaN;
  const rows = m.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = m[0].map((_, j) => m.reduce((a, r) => a + r[j], 0));
  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      observed += weight(i, j) * m[i][j];
      expected += (weight(i, j) * rows[i] * cols[j]) / n;
    }
  }
  if (expected === 0) return observed === 0 ? 1 : 0;
  return 1 - observed / expected;
}

export const cohenKappa = (m: ConfusionMatrix): number =>
  weightedKappa(m, (i, j) => (i === j ? 0 : 1));

export const quadraticWeightedKappa = (m: ConfusionMatrix): number =>
  weightedKappa(m, (i, j) => ((i - j) / (m.length - 1)) ** 2);

export interface Disagreement {
  pair: number;
  vacancyId: string;
  personaId: string;
  score: number;
  rule: Band;
  human: Band;
  note: string;
  requirements: Array<RequirementStatus & { text: string }>;
}

export interface Agreement {
  pairs: number;
  exactAgreement: number;
  kappa: number;
  quadraticKappa: number;
  /** Rows: rule band, columns: human band, both in `bands` order. */
  confusion: ConfusionMatrix;
  bands: readonly Band[];
  disagreements: Disagreement[];
}

export function computeAgreement(
  labels: readonly LabelEntry[],
  truth: readonly GroundTruthPair[],
  vacancies: readonly VacancySpec[],
): Agreement {
  const reqText = new Map(
    vacancies.flatMap((v) =>
      v.requirements.map((r) => [r.id, r.text] as const),
    ),
  );
  const rows = labels.map((l) => {
    const gt = truth.find(
      (p) => p.vacancyId === l.vacancyId && p.personaId === l.personaId,
    );
    if (!gt) {
      throw new Error(
        `Pair ${l.pair} (${l.vacancyId}, ${l.personaId}) is not in ground-truth.json`,
      );
    }
    return { label: l, gt, rule: gt.band, human: l.band as Band };
  });
  const confusion = confusionMatrix(rows);
  const agreed = rows.filter((r) => r.rule === r.human).length;
  return {
    pairs: rows.length,
    exactAgreement: rows.length === 0 ? Number.NaN : agreed / rows.length,
    kappa: cohenKappa(confusion),
    quadraticKappa: quadraticWeightedKappa(confusion),
    confusion,
    bands: BANDS,
    disagreements: rows
      .filter((r) => r.rule !== r.human)
      .map((r) => ({
        pair: r.label.pair,
        vacancyId: r.gt.vacancyId,
        personaId: r.gt.personaId,
        score: r.gt.score,
        rule: r.rule,
        human: r.human,
        note: r.label.note ?? '',
        requirements: r.gt.requirements.map((q) => ({
          ...q,
          text: reqText.get(q.requirementId) ?? '',
        })),
      })),
  };
}

const pct = (x: number): string =>
  Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`;
const num = (x: number): string => (Number.isNaN(x) ? 'n/a' : x.toFixed(3));

export function renderAgreementMarkdown(a: Agreement): string {
  const header = `| rule \\ human | ${a.bands.join(' | ')} |`;
  const out = [
    '# Spot-check agreement',
    '',
    `Pairs labelled: ${a.pairs}`,
    '',
    `- Exact band agreement: ${pct(a.exactAgreement)}`,
    `- Cohen's kappa (unweighted): ${num(a.kappa)}`,
    `- Cohen's kappa (quadratic weights): ${num(a.quadraticKappa)}`,
    '',
    '## Confusion matrix (rows: rule, columns: Dude)',
    '',
    header,
    `| --- |${a.bands.map(() => ' ---:').join(' |')} |`,
    ...a.bands.map((band, i) => `| ${band} | ${a.confusion[i].join(' | ')} |`),
    '',
    `## Disagreements (${a.disagreements.length})`,
  ];
  if (a.disagreements.length === 0) out.push('', 'None.');
  for (const d of a.disagreements) {
    out.push(
      '',
      `### Pair ${d.pair}: ${d.personaId} x ${d.vacancyId}`,
      '',
      `Rule: ${d.rule} (score ${d.score}), Dude: ${d.human}${d.note ? `. Note: ${d.note}` : ''}`,
      '',
      ...d.requirements.map(
        (q) =>
          `- ${q.requirementId}: ${q.status}${q.tag ? ` (${q.tag})` : ''}${q.text ? ` - ${q.text}` : ''}`,
      ),
    );
  }
  return `${out.join('\n')}\n`;
}
