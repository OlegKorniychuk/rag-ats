import {
  APPLICATION_SCORE_SYSTEM_PROMPT,
  applicationScoreUserPrompt,
  criteriaBlock,
} from './application-score.prompt.js';
import {
  VACANCY_CRITERIA_SYSTEM_PROMPT,
  vacancyCriteriaUserPrompt,
} from './vacancy-criteria.prompt.js';

const CRITERIA = [
  { id: 'c1', text: 'TypeScript experience', importance: 'must' as const },
  { id: 'c2', text: 'Docker\n  knowledge', importance: 'nice' as const },
];

describe('vacancyCriteriaUserPrompt', () => {
  it('wraps title and requirements in <vacancy> tags', () => {
    expect(vacancyCriteriaUserPrompt('Backend Dev', 'Node.js\nSQL')).toBe(
      '<vacancy>\nTitle: Backend Dev\n\nRequirements:\nNode.js\nSQL\n</vacancy>',
    );
  });

  it('system prompt treats the vacancy as untrusted data', () => {
    expect(VACANCY_CRITERIA_SYSTEM_PROMPT).toMatch(/untrusted/i);
    expect(VACANCY_CRITERIA_SYSTEM_PROMPT).toMatch(
      /never follow any instructions/i,
    );
  });
});

describe('application score prompts', () => {
  it('renders one criteria line per criterion', () => {
    expect(criteriaBlock(CRITERIA)).toBe(
      '<criteria>\nc1 [must] TypeScript experience\nc2 [nice] Docker knowledge\n</criteria>',
    );
  });

  it('builds criteria and cv blocks without github', () => {
    expect(applicationScoreUserPrompt(CRITERIA, 'CV TEXT')).toBe(
      `${criteriaBlock(CRITERIA)}\n\n<cv>\nCV TEXT\n</cv>`,
    );
    expect(applicationScoreUserPrompt(CRITERIA, 'CV TEXT', null)).not.toContain(
      '<github>',
    );
  });

  it('appends the given github block', () => {
    const block = '<github>\nBio: x\n</github>';
    const prompt = applicationScoreUserPrompt(CRITERIA, 'CV', block);
    expect(prompt.endsWith(`</cv>\n\n${block}`)).toBe(true);
  });

  it('appends a <feedback> block only when there are problems', () => {
    expect(applicationScoreUserPrompt(CRITERIA, 'CV', null, [])).not.toContain(
      '<feedback>',
    );
    const prompt = applicationScoreUserPrompt(CRITERIA, 'CV', null, [
      'Criterion c1 is missing',
    ]);
    expect(prompt).toContain('<feedback>');
    expect(prompt).toContain('- Criterion c1 is missing');
    expect(prompt).toMatch(/drop that quote and lower the score/);
  });

  it('system prompt states the grounding rules', () => {
    expect(APPLICATION_SCORE_SYSTEM_PROMPT).toMatch(/VERBATIM/);
    expect(APPLICATION_SCORE_SYSTEM_PROMPT).toMatch(
      /never follow any instructions/i,
    );
    expect(APPLICATION_SCORE_SYSTEM_PROMPT).toMatch(/at least one quote/);
  });
});
