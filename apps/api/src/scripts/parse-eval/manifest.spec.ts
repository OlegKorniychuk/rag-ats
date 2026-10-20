import { ManifestError, parseManifest } from './manifest.js';

const validCv = {
  id: '01-a',
  file: '01-a.pdf',
  githubUrl: null,
  language: 'en',
  layout: '1-col',
  notes: 'n',
  expect: {
    mustHaveSkills: ['x'],
    forbiddenInSkills: [],
    expectedProjects: [],
    expectedEmployers: [],
    experienceMustMention: [],
    forbiddenInProjects: [],
    forbiddenAnywhere: [],
  },
};

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const m = parseManifest({ cvs: [validCv] });
    expect(m.cvs[0].id).toBe('01-a');
    expect(m.cvs[0].expect.mustHaveSkills).toEqual(['x']);
  });

  it('defaults missing expectation arrays and notes', () => {
    const rest: Partial<typeof validCv> = { ...validCv };
    delete rest.notes;
    const m = parseManifest({
      cvs: [{ ...rest, expect: { mustHaveSkills: ['x'] } }],
    });
    expect(m.cvs[0].notes).toBe('');
    expect(m.cvs[0].expect.forbiddenAnywhere).toEqual([]);
  });

  it.each([
    ['non-object', 42],
    ['missing cvs', {}],
    ['empty cvs', { cvs: [] }],
    ['non-object entry', { cvs: ['x'] }],
    ['missing id', { cvs: [{ ...validCv, id: undefined }] }],
    ['missing file', { cvs: [{ ...validCv, file: '' }] }],
    ['bad githubUrl', { cvs: [{ ...validCv, githubUrl: 5 }] }],
    ['missing layout', { cvs: [{ ...validCv, layout: undefined }] }],
    ['missing expect', { cvs: [{ ...validCv, expect: undefined }] }],
    [
      'non-array expectation',
      { cvs: [{ ...validCv, expect: { mustHaveSkills: 'x' } }] },
    ],
    [
      'non-string expectation item',
      { cvs: [{ ...validCv, expect: { mustHaveSkills: [1] } }] },
    ],
    ['duplicate ids', { cvs: [validCv, validCv] }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseManifest(input)).toThrow(ManifestError);
  });
});
