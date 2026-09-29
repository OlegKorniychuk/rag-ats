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

export const STAGES = (Object.keys(STAGE_LABELS) as ApplicationStage[]).map(
  (id) => ({ id, label: STAGE_LABELS[id] }),
);

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
    groups[stage.id].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
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
