import { loadDraftData } from './test-data.js';
import { renderVacancyText, validateVacancies } from './vacancies.js';

describe('draft vacancies', () => {
  it('covers the ten role families with 6-10 tagged requirements each', async () => {
    const { vacancies, taxonomy } = await loadDraftData();
    expect(vacancies.map((v) => v.id)).toEqual([
      'frontend',
      'backend-java',
      'backend-node',
      'full-stack',
      'data-engineering',
      'ml',
      'platform-devops',
      'mobile',
      'qa-automation',
      'security',
    ]);
    for (const v of vacancies) {
      expect(v.requirements.length).toBeGreaterThanOrEqual(6);
      expect(v.requirements.length).toBeLessThanOrEqual(10 + 1);
      expect(v.requirements.some((r) => r.minYears)).toBe(true);
    }
    expect(validateVacancies(vacancies, taxonomy)).toEqual([]);
  });

  it('keeps the stored text in sync with the renderer', async () => {
    const { vacancies } = await loadDraftData();
    for (const v of vacancies) expect(v.text).toBe(renderVacancyText(v));
  });

  it('flags unknown tags and duplicate ids', async () => {
    const { vacancies, taxonomy } = await loadDraftData();
    const bad = [
      vacancies[0],
      {
        ...vacancies[0],
        requirements: [{ ...vacancies[0].requirements[0], tags: ['nope'] }],
      },
    ];
    const problems = validateVacancies(bad, taxonomy);
    expect(problems).toContain('duplicate vacancy id frontend');
    expect(problems).toContain('duplicate requirement id fe-exp');
    expect(problems).toContain('fe-exp: unknown tag "nope"');
  });
});

describe('renderVacancyText', () => {
  it('groups requirements by kind', () => {
    const text = renderVacancyText({
      title: 'T',
      intro: 'I',
      requirements: [
        { id: 'a', text: 'must A', kind: 'must', tags: ['x'] },
        { id: 'b', text: 'nice B', kind: 'nice', tags: ['y'] },
      ],
    });
    expect(text).toBe(
      'T\n\nI\n\nRequirements\n- must A\n\nNice to have\n- nice B\n',
    );
  });
});
