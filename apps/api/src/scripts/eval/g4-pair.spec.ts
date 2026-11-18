import { loadDraftData } from '../synth/test-data.js';
import type { GroundTruthPair, PersonaSpec, Taxonomy } from '../synth/types.js';
import { g4ForRecord, githubOnlyMetTags } from './g4-pair.js';
import type { EvalDataset } from './preflight.js';
import type { RecordedCriterion, ScoreOkRecord } from './score-record.js';

let taxonomy: Taxonomy;
beforeAll(async () => {
  ({ taxonomy } = await loadDraftData());
});

const persona = (
  id: string,
  skills: Array<[string, PersonaSpec['skills'][number]['evidence']]>,
): PersonaSpec => ({
  id,
  name: id,
  email: `${id}@example.com`,
  language: 'en',
  layout: '1-col',
  roles: [],
  projects: [],
  skills: skills.map(([tag, evidence]) => ({ tag, years: 0, evidence })),
  github: null,
  kind: 'targeted',
  flags: [],
  applyTo: [],
});

const pair = (
  personaId: string,
  requirements: GroundTruthPair['requirements'],
): GroundTruthPair => ({
  vacancyId: 'v1',
  personaId,
  score: 60,
  band: 'partial',
  requirements,
});

const dataset = (): EvalDataset =>
  ({
    taxonomy,
    personas: [
      persona('p1', [
        ['rust', 'github_only'],
        ['typescript', 'cv_role'],
        ['docker', 'github_only'],
        ['kubernetes', 'github_only'],
      ]),
      persona('p2', [['rust', 'cv_role']]),
    ],
    groundTruth: {
      pairs: [
        pair('p1', [
          { requirementId: 'r1', status: 'met', tag: 'rust' },
          { requirementId: 'r2', status: 'met', tag: 'typescript' },
          { requirementId: 'r3', status: 'partial', tag: 'docker' },
          { requirementId: 'r4', status: 'met', tag: 'kubernetes' },
          { requirementId: 'r5', status: 'met', tag: 'rust' },
          { requirementId: 'r6', status: 'not_met' },
        ]),
        pair('p2', [{ requirementId: 'r1', status: 'met', tag: 'rust' }]),
      ],
    },
  }) as unknown as EvalDataset;

const criterion = (
  id: string,
  text: string,
  score: number,
  quotes: RecordedCriterion['quotes'] = [],
): RecordedCriterion => ({
  id,
  text,
  importance: 'must',
  score,
  reasoning: '',
  quotes,
});

const record = (
  personaId: string,
  criteria: RecordedCriterion[],
): ScoreOkRecord => ({
  key: `v1|${personaId}|full_text|1`,
  vacancyId: 'v1',
  personaId,
  mode: 'full_text',
  run: 1,
  at: '',
  status: 'ok',
  overall: 50,
  criteria,
  attempts: 1,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

describe('githubOnlyMetTags', () => {
  it('lists met tags whose persona skill is github_only, deduplicated and sorted', () => {
    expect(
      githubOnlyMetTags(dataset(), { vacancyId: 'v1', personaId: 'p1' }),
    ).toEqual(['kubernetes', 'rust']);
  });

  it('is empty when the persona has the tag in the CV, or the pair is unknown', () => {
    const ds = dataset();
    expect(githubOnlyMetTags(ds, { vacancyId: 'v1', personaId: 'p2' })).toEqual(
      [],
    );
    expect(githubOnlyMetTags(ds, { vacancyId: 'v9', personaId: 'p1' })).toEqual(
      [],
    );
  });
});

describe('g4ForRecord', () => {
  it('reports mapped, credited and citedGithub per tag', () => {
    const results = g4ForRecord(
      record('p1', [
        criterion('c1', 'Production experience with Rust', 80, [
          { source: 'github', text: 'Rust service' },
        ]),
        criterion('c2', 'Good communication', 90),
      ]),
      dataset(),
    );
    expect(results).toEqual([
      {
        tag: 'kubernetes',
        mapped: false,
        criterionIds: [],
        credited: false,
        citedGithub: false,
      },
      {
        tag: 'rust',
        mapped: true,
        criterionIds: ['c1'],
        credited: true,
        citedGithub: true,
      },
    ]);
  });

  it('mapped but ignored: not credited, no github quote', () => {
    const [kube, rust] = g4ForRecord(
      record('p1', [
        criterion('c1', 'Rust or Go', 0),
        criterion('c2', 'Kubernetes in production', 40, [
          { source: 'cv', text: 'ops work' },
        ]),
      ]),
      dataset(),
    );
    expect(kube).toMatchObject({
      tag: 'kubernetes',
      mapped: true,
      credited: true,
      citedGithub: false,
    });
    expect(rust).toMatchObject({
      tag: 'rust',
      mapped: true,
      credited: false,
      citedGithub: false,
    });
  });

  it('is empty for a pair without github-only tags', () => {
    expect(g4ForRecord(record('p2', []), dataset())).toEqual([]);
  });
});
