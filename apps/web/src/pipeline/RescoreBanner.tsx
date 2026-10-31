import type { ApplicationScore, VacancyStatus } from '@rag-ats/shared';
import { Alert } from '@mui/material';
import { isStaleInFlight, isStaleSettled } from './score';

interface RescoreBannerProps {
  vacancyStatus: VacancyStatus;
  applications: readonly { score: ApplicationScore }[];
}

export function RescoreBanner({
  vacancyStatus,
  applications,
}: RescoreBannerProps) {
  const rescoring = applications.filter((application) =>
    isStaleInFlight(application.score),
  ).length;

  if (rescoring > 0) {
    return (
      <Alert severity="info">
        {rescoring === 1
          ? 'Re-scoring 1 applicant. Its previous score is greyed out until the new one is ready.'
          : `Re-scoring ${rescoring} applicants. Their previous scores are greyed out until the new ones are ready.`}
      </Alert>
    );
  }

  if (
    vacancyStatus === 'closed' &&
    applications.some((application) => isStaleSettled(application.score))
  ) {
    return (
      <Alert severity="warning">
        Scores are outdated: the requirements changed while the vacancy was
        closed. Reopen the vacancy to re-score its applicants.
      </Alert>
    );
  }

  return null;
}
