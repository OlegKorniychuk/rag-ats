import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApplicationScore } from '@rag-ats/shared';
import { RescoreBanner } from './RescoreBanner';

const makeScore = (overrides: Partial<ApplicationScore>): ApplicationScore => ({
  status: 'scored',
  error: null,
  waitingForParse: false,
  stale: false,
  result: null,
  ...overrides,
});

const wrap = (...scores: ApplicationScore[]) =>
  scores.map((score) => ({ score }));

const staleInFlight = makeScore({ status: 'pending', stale: true });
const staleSettled = makeScore({ status: 'scored', stale: true });

describe('RescoreBanner', () => {
  it('shows the plural info banner with the stale in-flight count', () => {
    render(
      <RescoreBanner
        vacancyStatus="open"
        applications={wrap(
          staleInFlight,
          makeScore({ status: 'scoring', stale: true }),
          makeScore({ status: 'scored' }),
        )}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Re-scoring 2 applicants. Their previous scores are greyed out until the new ones are ready.',
    );
  });

  it('uses the singular wording for one applicant', () => {
    render(
      <RescoreBanner vacancyStatus="open" applications={wrap(staleInFlight)} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Re-scoring 1 applicant. Its previous score is greyed out until the new one is ready.',
    );
  });

  it('shows the outdated warning on a closed vacancy with stale scores', () => {
    render(
      <RescoreBanner
        vacancyStatus="closed"
        applications={wrap(staleSettled)}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Scores are outdated: the requirements changed while the vacancy was closed. Reopen the vacancy to re-score its applicants.',
    );
  });

  it('prefers the in-flight banner on a closed vacancy', () => {
    render(
      <RescoreBanner
        vacancyStatus="closed"
        applications={wrap(staleInFlight, staleSettled)}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Re-scoring 1');
    expect(screen.queryByText(/Scores are outdated/)).not.toBeInTheDocument();
  });

  it('shows nothing for an open vacancy with stale settled scores', () => {
    render(
      <RescoreBanner vacancyStatus="open" applications={wrap(staleSettled)} />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing for non-stale in-flight scores', () => {
    render(
      <RescoreBanner
        vacancyStatus="open"
        applications={wrap(
          makeScore({ status: 'pending' }),
          makeScore({ status: 'scoring' }),
        )}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing for a closed vacancy with fresh scores', () => {
    render(
      <RescoreBanner
        vacancyStatus="closed"
        applications={wrap(makeScore({ status: 'scored' }))}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing with no applications', () => {
    render(<RescoreBanner vacancyStatus="closed" applications={[]} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
