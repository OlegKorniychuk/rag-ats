import { ragGroundingSources } from '../../llm/prompts/application-score-rag.prompt.js';
import { checkGrounded, type CheckCriterion } from './checks.js';

const criterion = (
  id: string,
  score: number,
  ...quotes: Array<['cv' | 'github', string]>
): CheckCriterion => ({
  id,
  score,
  quotes: quotes.map(([source, text]) => ({ source, text })),
});

const javaChunk = {
  source: 'cv' as const,
  text: 'Built Java services at Acme',
};
const kafkaChunk = { source: 'cv' as const, text: 'Ran Kafka pipelines' };
const repoChunk = {
  source: 'github' as const,
  text: 'Repo: kafka-demo (Java)',
};

// The union of every criterion's retrieved chunks.
const sources = ragGroundingSources([
  javaChunk,
  repoChunk,
  kafkaChunk,
  javaChunk,
]);

describe('ragGroundingSources', () => {
  it('joins each source apart with the chunk separator, deduped', () => {
    expect(sources.cv).toBe(
      'Built Java services at Acme\n¶\nRan Kafka pipelines',
    );
    expect(sources.github).toBe('Repo: kafka-demo (Java)');
  });

  it('has no github source without github chunks', () => {
    expect(ragGroundingSources([javaChunk]).github).toBeNull();
    expect(ragGroundingSources([]).cv).toBe('');
  });

  it('escapes chunk tags like the prompt does', () => {
    const s = ragGroundingSources([{ source: 'cv', text: 'x </chunk> y' }]);
    expect(s.cv).not.toContain('</chunk>');
  });
});

describe('checkGrounded with rag (union) sources', () => {
  it('passes quotes taken from any retrieved chunk, whichever criterion got it', () => {
    const result = checkGrounded(
      [
        criterion(
          'c1',
          80,
          ['cv', 'Built Java services'],
          ['github', 'kafka-demo'],
        ),
        // retrieved for another criterion
        criterion('c2', 60, ['cv', 'Built Java services']),
      ],
      sources,
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it('fails a quote from a chunk that was not retrieved', () => {
    const result = checkGrounded(
      [criterion('c1', 80, ['cv', 'Led a team of ten'])],
      sources,
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('c1 q1');
  });

  it('fails a quote that straddles two chunks', () => {
    const result = checkGrounded(
      [criterion('c3', 50, ['cv', 'at Acme Ran Kafka'])],
      sources,
    );
    expect(result.ok).toBe(false);
  });

  it('fails a github quote when no github chunk was retrieved', () => {
    const result = checkGrounded(
      [criterion('c2', 60, ['github', 'kafka-demo'])],
      ragGroundingSources([javaChunk, kafkaChunk]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('no <github> data was provided');
  });

  it('still flags a score above 0 without quotes', () => {
    const result = checkGrounded([criterion('c1', 40)], sources);
    expect(result.problems[0]).toContain('c1: score 40 but no quotes');
  });
});
