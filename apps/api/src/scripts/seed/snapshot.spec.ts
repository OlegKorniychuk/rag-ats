import {
  isDrained,
  queuedWork,
  summarize,
  type CandidateRow,
  type ScoreRow,
  type SeedSnapshot,
} from './snapshot.js';

const candidate = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  id: 'c1',
  email: 'c1@example.com',
  parseStatus: 'parsed',
  parseError: null,
  parsedCvDocumentId: 'cv1',
  embeddedCvDocumentId: 'cv1',
  ...over,
});

const score = (over: Partial<ScoreRow> = {}): ScoreRow => ({
  applicationId: 'a1',
  candidateId: 'c1',
  vacancyTitle: 'V',
  status: 'scored',
  error: null,
  ...over,
});

const snap = (
  candidates: CandidateRow[],
  scores: ScoreRow[],
): SeedSnapshot => ({ candidates, scores });

describe('isDrained', () => {
  it('is true when everything settled', () => {
    expect(isDrained(snap([candidate()], [score()]))).toBe(true);
    expect(isDrained(snap([candidate()], [score({ status: 'failed' })]))).toBe(
      true,
    );
  });

  it('waits for a candidate that is not parsed or failed', () => {
    expect(
      isDrained(snap([candidate({ parseStatus: 'parsing' })], [score()])),
    ).toBe(false);
    expect(
      isDrained(snap([candidate({ parseStatus: 'pending' })], [score()])),
    ).toBe(false);
  });

  it('waits for the embedding of the parsed CV', () => {
    expect(
      isDrained(snap([candidate({ embeddedCvDocumentId: null })], [score()])),
    ).toBe(false);
    expect(
      isDrained(
        snap([candidate({ embeddedCvDocumentId: 'old-cv' })], [score()]),
      ),
    ).toBe(false);
  });

  it('waits for pending and scoring scores', () => {
    expect(isDrained(snap([candidate()], [score({ status: 'pending' })]))).toBe(
      false,
    );
    expect(isDrained(snap([candidate()], [score({ status: 'scoring' })]))).toBe(
      false,
    );
  });

  it('ignores scores (and embedding) of a candidate whose parse failed', () => {
    const failed = candidate({
      parseStatus: 'failed',
      parsedCvDocumentId: null,
      embeddedCvDocumentId: null,
    });
    expect(isDrained(snap([failed], [score({ status: 'pending' })]))).toBe(
      true,
    );
  });
});

describe('summarize', () => {
  it('counts parse, embed and score outcomes', () => {
    const counts = summarize(
      snap(
        [
          candidate({ id: 'c1' }),
          candidate({
            id: 'c2',
            parseStatus: 'failed',
            parsedCvDocumentId: null,
            embeddedCvDocumentId: null,
          }),
          candidate({ id: 'c3', parseStatus: 'pending' }),
        ],
        [
          score({ applicationId: 'a1' }),
          score({ applicationId: 'a2', status: 'failed' }),
          score({ applicationId: 'a3', candidateId: 'c2', status: 'pending' }),
        ],
      ),
    );
    expect(counts).toEqual({
      candidates: 3,
      parsed: 1,
      failedParses: 1,
      parsePending: 1,
      embedded: 1,
      applications: 3,
      scored: 1,
      failedScores: 1,
      scoresPending: 1,
    });
  });
});

describe('queuedWork', () => {
  it('counts what is still to be spent on', () => {
    const work = queuedWork(
      snap(
        [
          candidate({ id: 'c1' }),
          candidate({ id: 'c2', parseStatus: 'pending' }),
          candidate({ id: 'c3', embeddedCvDocumentId: null }),
          candidate({ id: 'c4', parseStatus: 'failed' }),
        ],
        [
          score({ applicationId: 'a1', candidateId: 'c1' }),
          score({ applicationId: 'a2', candidateId: 'c2', status: 'pending' }),
          score({ applicationId: 'a3', candidateId: 'c3', status: 'scoring' }),
          score({ applicationId: 'a4', candidateId: 'c4', status: 'pending' }),
        ],
      ),
    );
    expect(work).toEqual({ unparsed: 1, unembedded: 1, unscored: 2 });
  });
});
