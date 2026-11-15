import type { Taxonomy, VacancySpec } from './types.js';

/** The text a candidate pipeline sees: title, intro, then grouped requirements. */
export function renderVacancyText(
  vacancy: Pick<VacancySpec, 'title' | 'intro' | 'requirements'>,
): string {
  const lines = (kind: 'must' | 'nice') =>
    vacancy.requirements
      .filter((r) => r.kind === kind)
      .map((r) => `- ${r.text}`)
      .join('\n');
  return [
    vacancy.title,
    '',
    vacancy.intro,
    '',
    'Requirements',
    lines('must'),
    '',
    'Nice to have',
    lines('nice'),
    '',
  ].join('\n');
}

/** Structural problems that would make the ground truth meaningless. */
export function validateVacancies(
  vacancies: VacancySpec[],
  taxonomy: Taxonomy,
): string[] {
  const known = new Set(taxonomy.tags.map((t) => t.tag));
  const problems: string[] = [];
  const ids = new Set<string>();
  const reqIds = new Set<string>();
  for (const v of vacancies) {
    if (ids.has(v.id)) problems.push(`duplicate vacancy id ${v.id}`);
    ids.add(v.id);
    if (v.requirements.length === 0) problems.push(`${v.id}: no requirements`);
    for (const r of v.requirements) {
      if (reqIds.has(r.id)) problems.push(`duplicate requirement id ${r.id}`);
      reqIds.add(r.id);
      if (r.tags.length === 0) problems.push(`${r.id}: no tags`);
      for (const tag of r.tags) {
        if (!known.has(tag)) problems.push(`${r.id}: unknown tag "${tag}"`);
      }
    }
  }
  return problems;
}
