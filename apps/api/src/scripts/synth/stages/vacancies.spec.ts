import 'reflect-metadata'; // shared/cli.js pulls in decorated env config
import { stripSectionLabel } from './vacancies.js';

describe('stripSectionLabel', () => {
  it.each([
    ['Nice to have: experience with Docker', 'Experience with Docker'],
    ['Must have - 3+ years of Java', '3+ years of Java'],
    ['nice to have – Redis for caching', 'Redis for caching'],
    [
      '  Experience with Kafka or RabbitMQ  ',
      'Experience with Kafka or RabbitMQ',
    ],
  ])('%s', (input, expected) => {
    expect(stripSectionLabel(input)).toBe(expected);
  });

  it('keeps a requirement that only mentions a label word later', () => {
    expect(stripSectionLabel('Docker experience is a plus')).toBe(
      'Docker experience is a plus',
    );
  });
});
