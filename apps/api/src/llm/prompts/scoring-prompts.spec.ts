import {
  VACANCY_CRITERIA_SYSTEM_PROMPT,
  vacancyCriteriaUserPrompt,
} from './vacancy-criteria.prompt.js';

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
