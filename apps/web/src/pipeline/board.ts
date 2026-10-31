import type {
  ApplicationStage,
  ApplicationWithCandidateResponse,
} from '@rag-ats/shared';

const STAGE_LABELS = {
  applied: 'Applied',
  screened: 'Screened',
  interview: 'Interview',
  rejected: 'Rejected',
  hired: 'Hired',
} satisfies Record<ApplicationStage, string>;

export const stageLabel = (stage: ApplicationStage): string =>
  STAGE_LABELS[stage];

export const STAGES = (Object.keys(STAGE_LABELS) as ApplicationStage[]).map(
  (id) => ({ id, label: STAGE_LABELS[id] }),
);

export type Stage = (typeof STAGES)[number];

// Highest score first (a stale result still counts with its old number), then
// unscored, ties broken by application date, oldest first.
function compareApplications(
  a: ApplicationWithCandidateResponse,
  b: ApplicationWithCandidateResponse,
): number {
  const scoreA = a.score.result?.overall;
  const scoreB = b.score.result?.overall;
  if (scoreA !== undefined && scoreB !== undefined && scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  if ((scoreA === undefined) !== (scoreB === undefined)) {
    return scoreA === undefined ? 1 : -1;
  }
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export function groupByStage(
  applications: readonly ApplicationWithCandidateResponse[],
): Record<ApplicationStage, ApplicationWithCandidateResponse[]> {
  const groups = Object.fromEntries(
    STAGES.map((stage) => [stage.id, []]),
  ) as unknown as Record<ApplicationStage, ApplicationWithCandidateResponse[]>;
  for (const application of applications) {
    groups[application.stage].push(application);
  }
  for (const stage of STAGES) {
    groups[stage.id].sort(compareApplications);
  }
  return groups;
}

export function resolveDrop(
  activeId: string,
  overId: string | null,
  applications: readonly ApplicationWithCandidateResponse[],
): { id: string; stage: ApplicationStage } | null {
  if (overId === null) return null;
  const targetStage = STAGES.find((stage) => stage.id === overId)?.id;
  if (!targetStage) return null;
  const active = applications.find(
    (application) => application.id === activeId,
  );
  if (!active) return null;
  if (active.stage === targetStage) return null;
  return { id: activeId, stage: targetStage };
}
