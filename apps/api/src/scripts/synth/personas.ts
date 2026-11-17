/**
 * Persona generator: structured specs only, no LLM. Everything is driven by a
 * seeded RNG, so a seed always reproduces the same 100 personas.
 *
 * How a persona is built (see `buildFromVacancy`):
 *  1. For each requirement of a vacancy, draw a level (met / partial / missing)
 *     that fits the target band. Targets only guide sampling: the ground-truth
 *     rule is always recomputed from the finished persona, and a persona whose
 *     real band misses its target is re-rolled (bounded), then accepted.
 *  2. Turn levels into a plan per tag: shown in roles (with a minimum or a
 *     maximum number of months), in a project, only on GitHub, or only in the
 *     skills list (keyword stuffing).
 *  3. Build a career timeline in code and attach tags to roles until the plan
 *     is satisfied. Skill years are the summed months of the roles using the
 *     tag. Project-only and skills-only tags have 0 years (a bootcamp junior
 *     with project-only React is "partial" for a 2+ years requirement).
 *     github_only tags have no role to sum, so the generator sets their years
 *     (years of repo activity), at least minYears when the plan is "met".
 */
import {
  checkDistribution,
  computeGroundTruth,
  DEFAULT_GUARD,
  scoreVacancy,
  type DistributionGuard,
} from './ground-truth.js';
import {
  EMPLOYERS,
  EXP_TITLES,
  FULL_STACK_TITLES,
  GENERIC_TITLES,
  makeIdentity,
  NON_TECH_TITLES,
  projectName,
} from './names.js';
import { createRng, type Rng } from './rng.js';
import {
  layoutTimeline,
  monthsToYears,
  roleMonths,
  splitMonths,
} from './timeline.js';
import type {
  Language,
  Layout,
  PersonaFlag,
  PersonaSpec,
  Project,
  Role,
  Skill,
  Taxonomy,
  TaxonomyTag,
  VacancySpec,
} from './types.js';

export const PERSONAS_PER_BAND = 4;
export const UK_COUNT = 5;
export const GITHUB_SHARE = 0.4;
/** Probes per vacancy: targeted personas whose key evidence is GitHub only. */
const PROBES_PER_VACANCY = 3;
const MAX_REROLLS = 40;
const MAX_CAREER_MONTHS = 168;

const LAYOUTS: Layout[] = ['1-col', '2-col', 'compact'];

/** Vacancies that share skills; used for cross-fits and adjacent candidates. */
const NEIGHBOURS: Record<string, string[]> = {
  frontend: ['full-stack', 'qa-automation', 'mobile'],
  'backend-java': ['backend-node', 'full-stack', 'platform-devops'],
  'backend-node': ['backend-java', 'full-stack', 'frontend'],
  'full-stack': ['frontend', 'backend-node', 'backend-java'],
  'data-engineering': ['ml', 'backend-java', 'platform-devops'],
  ml: ['data-engineering', 'backend-node'],
  'platform-devops': ['security', 'backend-java', 'data-engineering'],
  mobile: ['frontend', 'full-stack'],
  'qa-automation': ['frontend', 'backend-node', 'security'],
  security: ['platform-devops', 'qa-automation'],
};

/**
 * A permutation of the vacancies (each is the partner of exactly one other),
 * so cross-fit personas reach every vacancy and the distribution guard passes
 * by construction rather than by luck.
 */
const PARTNER: Record<string, string> = {
  frontend: 'mobile',
  mobile: 'full-stack',
  'full-stack': 'backend-node',
  'backend-node': 'backend-java',
  'backend-java': 'platform-devops',
  'platform-devops': 'security',
  security: 'qa-automation',
  'qa-automation': 'frontend',
  'data-engineering': 'ml',
  ml: 'data-engineering',
};

type Level = 'met' | 'partial' | 'missing';
type TargetBand = 'strong' | 'partial';

const LEVELS: Record<
  TargetBand,
  Record<'must' | 'nice', ReadonlyArray<readonly [Level, number]>>
> = {
  strong: {
    must: [
      ['met', 0.92],
      ['partial', 0.08],
    ],
    nice: [
      ['met', 0.7],
      ['missing', 0.3],
    ],
  },
  partial: {
    must: [
      ['met', 0.45],
      ['partial', 0.2],
      ['missing', 0.35],
    ],
    nice: [
      ['met', 0.35],
      ['missing', 0.65],
    ],
  },
};

interface PlanEntry {
  mode: 'role' | 'project' | 'github' | 'stuffed';
  /** role: attach to the most recent roles until this many months. */
  minMonths?: number;
  /** role: attach to roles while the sum stays strictly below this. */
  capMonths?: number;
  /** github: years of repo activity. */
  years?: number;
}

interface PlanState {
  plans: Map<string, PlanEntry>;
  /** Tags the persona must not end up with (missing requirements). */
  forbidden: Set<string>;
}

interface BuildOptions {
  /** Put the key evidence of a few requirements on GitHub only. */
  probe?: boolean;
  /** Chance that a "met" tag is shown only in a project. */
  projectBias?: number;
  /** [min, max] total months of the tech career. */
  careerRange?: [number, number];
  /** Non-tech roles placed before the tech career. */
  nonTechRoles?: number;
  /** Prefix every title with "Junior". */
  junior?: boolean;
  /** Also reach `band` for a neighbouring vacancy (cross-fit for the guard). */
  partner?: { id: string; band: TargetBand };
  /** At least this many projects. */
  minProjects?: number;
}

interface Draft {
  kind: PersonaSpec['kind'];
  target?: PersonaSpec['target'];
  flags: PersonaFlag[];
  roles: Role[];
  projects: Project[];
  skills: Skill[];
  /** Vacancy ids the persona must apply to. */
  applyHint: string[];
}

interface Ctx {
  taxonomy: Taxonomy;
  tags: Map<string, TaxonomyTag>;
  vacancies: VacancySpec[];
  rng: Rng;
  isExp(tag: string): boolean;
  fillerPool(familyId: string): string[];
}

function makeCtx(taxonomy: Taxonomy, vacancies: VacancySpec[], rng: Rng): Ctx {
  const tags = new Map(taxonomy.tags.map((t) => [t.tag, t]));
  const skillTags = taxonomy.tags.filter((t) => t.kind !== 'experience');
  return {
    taxonomy,
    tags,
    vacancies,
    rng,
    isExp: (tag) => tags.get(tag)?.kind === 'experience',
    fillerPool: (familyId) => {
      const own = skillTags
        .filter((t) => t.family?.includes(familyId) || !t.family?.length)
        .map((t) => t.tag);
      return own.length >= 5 ? own : skillTags.map((t) => t.tag);
    },
  };
}

/** Levels for the partner vacancy of a polyglot: only what is shown counts. */
const PARTNER_LEVELS: Record<
  TargetBand,
  Record<'must' | 'nice', ReadonlyArray<readonly [Level, number]>>
> = {
  strong: {
    must: [['met', 1]],
    nice: [
      ['met', 0.75],
      ['missing', 0.25],
    ],
  },
  partial: {
    must: [
      ['met', 0.7],
      ['missing', 0.3],
    ],
    nice: [
      ['met', 0.4],
      ['missing', 0.6],
    ],
  },
};

function pickLevel(
  rng: Rng,
  band: TargetBand,
  kind: 'must' | 'nice',
  secondary: boolean,
): Level {
  return rng.weighted((secondary ? PARTNER_LEVELS : LEVELS)[band][kind]);
}

/** Step 1 + 2: requirement levels -> a plan per tag. */
function planVacancy(
  ctx: Ctx,
  vacancy: VacancySpec,
  band: TargetBand,
  opts: BuildOptions,
  state: PlanState,
  secondary: boolean,
): void {
  const { rng } = ctx;
  const { plans, forbidden } = state;
  const levelled = vacancy.requirements.map((req) => ({
    req,
    level: pickLevel(rng, band, req.kind, secondary),
  }));

  if (!secondary) {
    for (const { req, level } of levelled) {
      if (level === 'missing') req.tags.forEach((t) => forbidden.add(t));
    }
  }

  const met = levelled.filter((l) => l.level === 'met');
  // Musts first, so GitHub-only evidence lands on the important requirements.
  const probeSlots = !opts.probe || secondary ? 0 : band === 'strong' ? 2 : 1;
  const githubReqs = new Set(
    met
      .filter(({ req }) => req.tags.some((t) => !ctx.isExp(t)))
      .sort(
        (a, b) => Number(b.req.kind === 'must') - Number(a.req.kind === 'must'),
      )
      .slice(0, probeSlots)
      .map(({ req }) => req.id),
  );

  for (const { req } of met) {
    const need = req.minYears ?? 0;
    const minMonths =
      need > 0 ? need * 12 + rng.int(0, 18) : 6 + rng.int(0, 12);
    const candidates = req.tags.filter((t) => !forbidden.has(t));
    if (candidates.length === 0) continue;
    const planned = candidates.filter((t) => plans.has(t));
    const fresh = candidates.filter((t) => !plans.has(t));
    const tag =
      planned.length > 0 && (fresh.length === 0 || rng.chance(0.7))
        ? rng.pick(planned)
        : rng.pick(fresh.length > 0 ? fresh : candidates);

    const existing = plans.get(tag);
    if (existing) {
      if (existing.mode === 'github') {
        existing.years = Math.max(existing.years ?? 0, need);
      } else {
        // Upgrade project / stuffed / capped entries to a real role skill.
        plans.set(tag, {
          mode: 'role',
          minMonths: Math.max(existing.minMonths ?? 0, minMonths),
        });
      }
      continue;
    }
    const exp = ctx.isExp(tag);
    if (githubReqs.has(req.id) && !exp) {
      plans.set(tag, {
        mode: 'github',
        years: need > 0 ? rng.int(need, need + 2) : rng.int(1, 4),
      });
    } else if (
      !exp &&
      rng.chance(opts.projectBias ?? (req.minYears === undefined ? 0.15 : 0))
    ) {
      plans.set(tag, { mode: 'project' });
    } else {
      plans.set(tag, { mode: 'role', minMonths });
    }
  }

  if (secondary) return;

  for (const { req } of levelled.filter((l) => l.level === 'partial')) {
    const candidates = req.tags.filter(
      (t) => !forbidden.has(t) && !plans.has(t),
    );
    if (candidates.length === 0) continue;
    const tag = rng.pick(candidates);
    const exp = ctx.isExp(tag);
    if (req.minYears && (exp || rng.chance(0.7))) {
      plans.set(tag, { mode: 'role', capMonths: req.minYears * 12 });
    } else if (!exp) {
      plans.set(tag, { mode: 'stuffed' });
    }
  }
}

function titleFor(ctx: Ctx, tags: Set<string>): string {
  const exps = [...tags].filter((t) => ctx.isExp(t));
  if (exps.includes('exp-frontend') && exps.includes('exp-backend')) {
    return ctx.rng.pick(FULL_STACK_TITLES);
  }
  const known = exps.find((t) => EXP_TITLES[t]);
  return ctx.rng.pick(known ? EXP_TITLES[known] : GENERIC_TITLES);
}

/** Step 3: the career, projects and skill list for a finished plan. */
function realize(
  ctx: Ctx,
  familyId: string,
  band: TargetBand,
  state: PlanState,
  opts: BuildOptions,
): Pick<Draft, 'roles' | 'projects' | 'skills'> {
  const { rng } = ctx;
  const { plans, forbidden } = state;

  const roleMinimums = [...plans.values()].map((p) => p.minMonths ?? 0);
  const maxMin = Math.max(12, ...roleMinimums);
  const total = Math.min(
    MAX_CAREER_MONTHS,
    opts.careerRange
      ? rng.int(...opts.careerRange)
      : band === 'strong'
        ? maxMin + rng.int(6, 30)
        : rng.int(14, 72),
  );
  const parts =
    total < 20
      ? 1
      : rng.int(2, Math.max(2, Math.min(4, Math.floor(total / 12))));
  const durations = splitMonths(total, parts, 8, rng);
  const nonTech = Array.from({ length: opts.nonTechRoles ?? 0 }, () =>
    rng.int(18, 60),
  );
  const all = layoutTimeline([...nonTech, ...durations], rng, rng.chance(0.6));

  const roleTagSets = durations.map(() => new Set<string>());
  const techSlots = all.slice(nonTech.length);

  for (const [tag, plan] of [...plans.entries()]) {
    if (plan.mode !== 'role') continue;
    if (plan.capMonths !== undefined) {
      let sum = 0;
      let added = 0;
      for (const i of rng.shuffle(durations.map((_, k) => k))) {
        const months = roleMonths(techSlots[i]);
        if (sum + months < plan.capMonths) {
          roleTagSets[i].add(tag);
          sum += months;
          added++;
        }
      }
      if (added === 0) {
        plans.delete(tag);
        forbidden.add(tag);
      }
    } else {
      let sum = 0;
      for (
        let i = durations.length - 1;
        i >= 0 && sum < (plan.minMonths ?? 0);
        i--
      ) {
        roleTagSets[i].add(tag);
        sum += roleMonths(techSlots[i]);
      }
    }
  }

  // Filler skills make roles look real; they never touch planned or forbidden tags.
  const pool = ctx
    .fillerPool(familyId)
    .filter((t) => !plans.has(t) && !forbidden.has(t));
  for (const set of roleTagSets) {
    if (pool.length === 0) break;
    for (const t of rng.sample(pool, rng.int(2, 4))) set.add(t);
  }

  const roles: Role[] = all.map((slot, i) => {
    if (i < nonTech.length) {
      return {
        employer: rng.pick(EMPLOYERS),
        title: rng.pick(NON_TECH_TITLES),
        ...slot,
        tags: [],
      };
    }
    const tags = roleTagSets[i - nonTech.length];
    let title = titleFor(ctx, tags);
    const index = i - nonTech.length;
    if (opts.junior) title = `Junior ${title}`;
    else if (index === 0 && durations.length >= 3) title = `Junior ${title}`;
    else if (
      index === durations.length - 1 &&
      durations.length > 1 &&
      durations.reduce((a, b) => a + b, 0) >= 60
    ) {
      title = `Senior ${title}`;
    }
    return {
      employer: rng.pick(EMPLOYERS),
      title,
      ...slot,
      tags: [...tags].sort(),
    };
  });
  // Distinct neighbours should not share an employer back to back.
  for (let i = 1; i < roles.length; i++) {
    while (roles[i].employer === roles[i - 1].employer) {
      roles[i].employer = rng.pick(EMPLOYERS);
    }
  }

  // Projects: planned project-only tags, plus extras built from role tags.
  const usedNames = new Set<string>();
  const projects: Project[] = [];
  const projectOnly = [...plans.entries()]
    .filter(([, p]) => p.mode === 'project')
    .map(([tag]) => tag);
  for (let i = 0; i < projectOnly.length;) {
    const take = rng.int(1, 2);
    projects.push({
      name: projectName(rng, usedNames),
      tags: projectOnly.slice(i, i + take).sort(),
    });
    i += take;
  }
  const roleTagList = [...new Set(roles.flatMap((r) => r.tags))].filter(
    (t) => !ctx.isExp(t),
  );
  const wantExtra = Math.max(
    (opts.minProjects ?? 0) - projects.length,
    roleTagList.length > 0 && rng.chance(0.4) ? 1 : 0,
  );
  for (let i = 0; i < wantExtra && roleTagList.length > 0; i++) {
    projects.push({
      name: projectName(rng, usedNames),
      tags: rng.sample(roleTagList, rng.int(1, 3)).sort(),
    });
  }

  // Skills: one entry per tag, strongest evidence first.
  const monthsByTag = new Map<string, number>();
  for (const role of roles) {
    const months = roleMonths(role);
    for (const tag of role.tags) {
      monthsByTag.set(tag, (monthsByTag.get(tag) ?? 0) + months);
    }
  }
  const skills = new Map<string, Skill>();
  for (const [tag, months] of monthsByTag) {
    skills.set(tag, { tag, years: monthsToYears(months), evidence: 'cv_role' });
  }
  for (const project of projects) {
    for (const tag of project.tags) {
      if (!skills.has(tag)) {
        skills.set(tag, { tag, years: 0, evidence: 'cv_project' });
      }
    }
  }
  for (const [tag, plan] of plans) {
    if (skills.has(tag)) continue;
    if (plan.mode === 'github') {
      skills.set(tag, { tag, years: plan.years ?? 1, evidence: 'github_only' });
    } else if (plan.mode === 'stuffed') {
      skills.set(tag, { tag, years: 0, evidence: 'cv_skills_only' });
    }
  }

  return {
    roles,
    projects,
    skills: [...skills.values()].sort((a, b) => a.tag.localeCompare(b.tag)),
  };
}

/** A persona realising `band` for `vacancy`; re-rolled until the rule agrees. */
function buildFromVacancy(
  ctx: Ctx,
  vacancy: VacancySpec,
  band: TargetBand,
  opts: BuildOptions = {},
): Pick<Draft, 'roles' | 'projects' | 'skills'> {
  let last!: Pick<Draft, 'roles' | 'projects' | 'skills'>;
  for (let attempt = 0; attempt < MAX_REROLLS; attempt++) {
    const state: PlanState = { plans: new Map(), forbidden: new Set() };
    planVacancy(ctx, vacancy, band, opts, state, false);
    const partner = opts.partner
      ? ctx.vacancies.find((v) => v.id === opts.partner!.id)
      : undefined;
    if (partner) {
      planVacancy(ctx, partner, opts.partner!.band, opts, state, true);
    }
    last = realize(ctx, vacancy.id, band, state, opts);
    if (
      scoreVacancy(last, vacancy).band === band &&
      (!partner || scoreVacancy(last, partner).band === opts.partner!.band)
    ) {
      return last;
    }
  }
  return last;
}

function buildStuffer(ctx: Ctx, vacancy: VacancySpec): Draft {
  const { rng } = ctx;
  const state: PlanState = { plans: new Map(), forbidden: new Set() };
  const stuffed = vacancy.requirements
    .flatMap((r) => r.tags.slice(0, 2))
    .filter((t) => !ctx.isExp(t));
  for (const tag of rng.sample([...new Set(stuffed)], rng.int(9, 14))) {
    state.plans.set(tag, { mode: 'stuffed' });
  }
  // Real experience comes from an unrelated family (and a non-tech past).
  const others = ctx.vacancies.filter((v) => v.id !== vacancy.id);
  const family = rng.pick(others).id;
  const parts = realize(ctx, family, 'partial', state, {
    careerRange: [24, 60],
    nonTechRoles: 1,
  });
  return {
    kind: 'off_target',
    flags: ['keyword_stuffer'],
    ...parts,
    applyHint: [],
  };
}

function partnerOf(ctx: Ctx, id: string): string {
  const fixed = PARTNER[id];
  if (fixed && ctx.vacancies.some((v) => v.id === fixed)) return fixed;
  const ids = ctx.vacancies.map((v) => v.id);
  return ids[(ids.indexOf(id) + 1) % ids.length];
}

function pickNeighbour(ctx: Ctx, id: string): string {
  const options = (NEIGHBOURS[id] ?? []).filter((n) =>
    ctx.vacancies.some((v) => v.id === n),
  );
  const pool = options.length
    ? options
    : ctx.vacancies.map((v) => v.id).filter((v) => v !== id);
  return ctx.rng.pick(pool);
}

/** All drafts for one attempt, in generation order (targeted, then off-target). */
function buildDrafts(ctx: Ctx): Draft[] {
  const { rng, vacancies } = ctx;
  const drafts: Draft[] = [];

  for (const vacancy of vacancies) {
    // Slots 0-1 of the strong band and slot 0 of the partial band are GitHub
    // probes. Slot 2 always reaches the fixed partner vacancy too, slot 3
    // sometimes a neighbour.
    for (const band of ['strong', 'partial'] as const) {
      for (let i = 0; i < PERSONAS_PER_BAND; i++) {
        const probe = i < (band === 'strong' ? PROBES_PER_VACANCY - 1 : 1);
        const partnerId =
          i === 2
            ? partnerOf(ctx, vacancy.id)
            : i === 3 && rng.chance(0.5)
              ? pickNeighbour(ctx, vacancy.id)
              : undefined;
        const parts = buildFromVacancy(ctx, vacancy, band, {
          probe,
          partner: partnerId ? { id: partnerId, band } : undefined,
        });
        drafts.push({
          kind: 'targeted',
          target: { vacancyId: vacancy.id, band },
          flags: [],
          ...parts,
          applyHint: [vacancy.id],
        });
      }
    }
  }

  const randomVacancy = () => rng.pick(vacancies);
  // 3 keyword stuffers
  for (let i = 0; i < 3; i++) drafts.push(buildStuffer(ctx, randomVacancy()));
  // 2 prompt-injection CVs: ordinary candidates, flagged for the CV stage
  for (let i = 0; i < 2; i++) {
    const parts = buildFromVacancy(
      ctx,
      randomVacancy(),
      rng.pick<TargetBand>(['strong', 'partial']),
    );
    drafts.push({
      kind: 'off_target',
      flags: ['injection'],
      ...parts,
      applyHint: [],
    });
  }
  // 5 career switchers: a non-tech past and a short, partial tech career
  for (let i = 0; i < 5; i++) {
    const parts = buildFromVacancy(ctx, randomVacancy(), 'partial', {
      careerRange: [10, 30],
      nonTechRoles: rng.int(1, 2),
    });
    drafts.push({
      kind: 'off_target',
      flags: ['career_switcher'],
      ...parts,
      applyHint: [],
    });
  }
  // 5 bootcamp juniors: mostly project evidence, under a year of work
  for (let i = 0; i < 5; i++) {
    const parts = buildFromVacancy(ctx, randomVacancy(), 'partial', {
      careerRange: [6, 14],
      junior: true,
      projectBias: 0.8,
      minProjects: 3,
    });
    drafts.push({
      kind: 'off_target',
      flags: ['bootcamp'],
      ...parts,
      applyHint: [],
    });
  }
  // 5 adjacent roles: strong for one vacancy, applying to a neighbouring one
  for (let i = 0; i < 5; i++) {
    const home = randomVacancy();
    const parts = buildFromVacancy(ctx, home, 'strong');
    drafts.push({
      kind: 'off_target',
      flags: ['adjacent'],
      ...parts,
      applyHint: [pickNeighbour(ctx, home.id)],
    });
  }
  return drafts;
}

function layoutAssignment(rng: Rng, count: number): Layout[] {
  return rng.shuffle(Array.from({ length: count }, (_, i) => LAYOUTS[i % 3]));
}

/** One attempt: drafts -> final personas with ids, identity, GitHub, applyTo. */
export function buildPersonas(
  taxonomy: Taxonomy,
  vacancies: VacancySpec[],
  seed: number,
): PersonaSpec[] {
  const rng = createRng(seed);
  const ctx = makeCtx(taxonomy, vacancies, rng);
  const drafts = rng.shuffle(buildDrafts(ctx));
  const n = drafts.length;

  const languages = new Set(
    rng.sample(
      drafts.map((_, i) => i),
      UK_COUNT,
    ),
  );
  const layouts = layoutAssignment(rng, n);
  const needsGithub = drafts.map((d) =>
    d.skills.some((s) => s.evidence === 'github_only'),
  );
  const githubTarget = Math.max(
    needsGithub.filter(Boolean).length,
    Math.round(n * GITHUB_SHARE),
  );
  const optional = rng.shuffle(
    drafts.map((_, i) => i).filter((i) => !needsGithub[i]),
  );
  const hasGithub = new Set([
    ...needsGithub.flatMap((need, i) => (need ? [i] : [])),
    ...optional.slice(0, githubTarget - needsGithub.filter(Boolean).length),
  ]);

  const usedSlugs = new Set<string>();
  const vacancyIds = vacancies.map((v) => v.id);
  return drafts.map((draft, i): PersonaSpec => {
    const language: Language = languages.has(i) ? 'uk' : 'en';
    const { name, slug } = makeIdentity(rng, language, usedSlugs);
    const wanted = draft.kind === 'targeted' ? rng.int(2, 3) : rng.int(1, 2);
    const applyTo = [...draft.applyHint];
    for (const id of rng.shuffle(vacancyIds)) {
      if (applyTo.length >= wanted) break;
      if (!applyTo.includes(id)) applyTo.push(id);
    }
    return {
      id: `p${String(i + 1).padStart(3, '0')}`,
      name,
      email: `${slug}@example.com`,
      language,
      layout: layouts[i],
      roles: draft.roles,
      projects: draft.projects,
      skills: draft.skills,
      github: hasGithub.has(i) ? { username: `synth-${slug}` } : null,
      kind: draft.kind,
      ...(draft.target ? { target: draft.target } : {}),
      flags: draft.flags,
      applyTo,
    };
  });
}

export class DistributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DistributionError';
  }
}

export interface GenerateOptions {
  guard?: DistributionGuard;
  /** Seeds tried: seed, seed+1, ... */
  maxAttempts?: number;
  /** Injection point for tests. */
  build?: typeof buildPersonas;
}

export interface GenerateResult {
  personas: PersonaSpec[];
  /** The seed that passed the guard. */
  seed: number;
  attempts: number;
}

/** Builds personas, re-sampling with the next seed until the guard passes. */
export function generatePersonas(
  taxonomy: Taxonomy,
  vacancies: VacancySpec[],
  seed: number,
  options: GenerateOptions = {},
): GenerateResult {
  const guard = options.guard ?? DEFAULT_GUARD;
  const maxAttempts = options.maxAttempts ?? 20;
  const build = options.build ?? buildPersonas;
  const vacancyIds = vacancies.map((v) => v.id);
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const personas = build(taxonomy, vacancies, seed + attempt);
    const gt = computeGroundTruth(personas, vacancies);
    lastProblems = checkDistribution(gt, vacancyIds, guard);
    if (lastProblems.length === 0) {
      return { personas, seed: seed + attempt, attempts: attempt + 1 };
    }
  }
  throw new DistributionError(
    `Distribution guard failed for seeds ${seed}..${seed + maxAttempts - 1}. ` +
      `Last attempt: ${lastProblems.join('; ')}. ` +
      'Loosen the vacancies or the persona sampling, or raise maxAttempts.',
  );
}
