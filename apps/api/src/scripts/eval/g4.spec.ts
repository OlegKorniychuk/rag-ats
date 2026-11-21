import { loadDraftData } from '../synth/test-data.js';
import type { Taxonomy } from '../synth/types.js';
import { criteriaMentioningTag } from './g4.js';

let taxonomy: Taxonomy;
beforeAll(async () => {
  ({ taxonomy } = await loadDraftData());
});

const criterion = (id: string, text: string) => ({
  id,
  text,
  importance: 'must' as const,
});

const ids = (found: Array<{ id: string }>): string[] => found.map((c) => c.id);

describe('criteriaMentioningTag', () => {
  const criteria = [
    criterion('c1', 'Strong experience with TypeScript and Node.js'),
    criterion('c2', 'Hands-on Docker and Kubernetes in production'),
    criterion('c3', 'Experience building RESTful APIs'),
    criterion('c4', 'Good written English'),
  ];

  it('finds the criteria that mention one of the tag aliases', () => {
    expect(
      ids(criteriaMentioningTag(criteria, 'typescript', taxonomy)),
    ).toEqual(['c1']);
    expect(
      ids(criteriaMentioningTag(criteria, 'kubernetes', taxonomy)),
    ).toEqual(['c2']);
    // an alias other than the label (RESTful for rest-api)
    expect(ids(criteriaMentioningTag(criteria, 'rest-api', taxonomy))).toEqual([
      'c3',
    ]);
  });

  it('returns every mentioning criterion, in the given order', () => {
    const more = [
      criterion('a', 'Docker in CI pipelines'),
      criterion('b', 'No containers here'),
      criterion('c', 'Writing Dockerfiles for Docker images'),
    ];
    expect(ids(criteriaMentioningTag(more, 'docker', taxonomy))).toEqual([
      'a',
      'c',
    ]);
  });

  it('matches on word boundaries: Java is not JavaScript', () => {
    const js = [criterion('c1', 'Solid JavaScript fundamentals')];
    expect(criteriaMentioningTag(js, 'java', taxonomy)).toEqual([]);
    expect(ids(criteriaMentioningTag(js, 'javascript', taxonomy))).toEqual([
      'c1',
    ]);
  });

  it('keeps ambiguous and short aliases case-sensitive', () => {
    const go = [
      criterion('c1', 'Proficiency in Go'),
      criterion('c2', 'Ability to go the extra mile'),
      criterion('c3', 'Experience with Golang services'),
    ];
    // "Go" counts as a language in a requirement even without a sentence cue; "go" does not
    expect(ids(criteriaMentioningTag(go, 'go', taxonomy))).toEqual([
      'c1',
      'c3',
    ]);
    // an all-caps acronym alias does not match the plain word
    const rest = [
      criterion('c1', 'Design REST endpoints'),
      criterion('c2', 'Ability to rest between releases'),
    ];
    expect(ids(criteriaMentioningTag(rest, 'rest-api', taxonomy))).toEqual([
      'c1',
    ]);
  });

  it('prefers the longest alias, so a longer tag does not credit the shorter one', () => {
    const actions = [criterion('c1', 'Pipelines in GitHub Actions')];
    expect(
      ids(criteriaMentioningTag(actions, 'github-actions', taxonomy)),
    ).toEqual(['c1']);
    expect(criteriaMentioningTag(actions, 'github', taxonomy)).toEqual([]);
  });

  it('is empty for experience tags, unknown tags and unmentioned tags', () => {
    expect(criteriaMentioningTag(criteria, 'exp-backend', taxonomy)).toEqual(
      [],
    );
    expect(criteriaMentioningTag(criteria, 'no-such-tag', taxonomy)).toEqual(
      [],
    );
    expect(criteriaMentioningTag(criteria, 'go', taxonomy)).toEqual([]);
    expect(criteriaMentioningTag([], 'docker', taxonomy)).toEqual([]);
  });

  it('keeps the caller criterion objects', () => {
    const [found] = criteriaMentioningTag(criteria, 'docker', taxonomy);
    expect(found).toBe(criteria[1]);
  });
});
