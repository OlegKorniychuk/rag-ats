/**
 * Fictional identity data for the persona generator. Names are mixed
 * first/last combinations, employers and projects are invented. Nothing here
 * is meant to match a real person or company.
 */
import type { Rng } from './rng.js';

const FIRST_EN = [
  'Daniel',
  'Priya',
  'Marta',
  'Tomasz',
  'Aisha',
  'Lukas',
  'Sofia',
  'Rohan',
  'Elena',
  'Mateo',
  'Hannah',
  'Kwame',
  'Ingrid',
  'Omar',
  'Chloe',
  'Viktor',
  'Nadia',
  'Samuel',
  'Leila',
  'Jonas',
  'Camila',
  'Arjun',
  'Freya',
  'Diego',
  'Mei',
  'Callum',
  'Zainab',
  'Felix',
  'Ananya',
  'Pavel',
  'Greta',
  'Hugo',
];
const LAST_EN = [
  'Whitfield',
  'Nair',
  'Kowalczyk',
  'Brandt',
  'Okafor',
  'Lindqvist',
  'Moreau',
  'Sharma',
  'Petrov',
  'Alvarez',
  'Hartmann',
  'Mensah',
  'Eriksen',
  'Haddad',
  'Dubois',
  'Novak',
  'Rahman',
  'Fischer',
  'Castillo',
  'Bianchi',
  'Ivanova',
  'Tanaka',
  'MacLeod',
  'Osei',
  'Kaya',
  'Varga',
  'Reyes',
  'Holm',
  'Banerjee',
  'Silva',
  'Larsen',
  'Demir',
];
const FIRST_UK = [
  'Oksana',
  'Taras',
  'Iryna',
  'Bohdan',
  'Olha',
  'Andrii',
  'Kateryna',
  'Maksym',
  'Yulia',
  'Dmytro',
  'Svitlana',
  'Roman',
  'Natalia',
  'Vasyl',
];
const LAST_UK = [
  'Kovalenko',
  'Shevchuk',
  'Bondarenko',
  'Tkachenko',
  'Melnyk',
  'Kravets',
  'Savchenko',
  'Lysenko',
  'Pavlenko',
  'Marchenko',
  'Honchar',
  'Rudenko',
  'Zinchenko',
  'Moroz',
];

export const EMPLOYERS = [
  'Quillstone Systems',
  'Harbor & Pike Software',
  'Lumenfield',
  'Tessera Works',
  'Corvid Analytics',
  'Brightwater Digital',
  'Ostrava Labs',
  'Pinecrest Cloud',
  'Marlowe & Finch Tech',
  'Nimbus Garden',
  'Redwren Software',
  'Kestrel Data',
  'Alderbank Technologies',
  'Fernhollow Studio',
  'Ironleaf Systems',
  'Saltmarsh Digital',
  'Velvet Circuit',
  'Copperline Labs',
  'Driftwood Apps',
  'Hexagon Meadow',
  'Juniper Relay',
  'Larkspur Engineering',
  'Mossgate Software',
  'Northgrove Networks',
  'Opaline Works',
  'Quartzfield',
  'Ravenmoor Tech',
  'Stonebridge Interactive',
  'Thistledown Labs',
  'Umber & Oak',
  'Vantage Reed',
  'Willowmere Software',
  'Yarrow Analytics',
  'Zephyr Foundry',
  'Ashgrove Digital',
  'Birchway Systems',
  'Cinder Peak',
  'Dovetail Robotics',
  'Emberlight Tech',
  'Foxglove Cloud',
];

export const NON_TECH_TITLES = [
  'Accountant',
  'Sales Manager',
  'High School Teacher',
  'Customer Support Lead',
  'Marketing Specialist',
  'Logistics Coordinator',
  'Project Coordinator',
  'Retail Store Manager',
];

const PROJECT_ADJ = [
  'Orbit',
  'Paper',
  'Amber',
  'Quiet',
  'Rapid',
  'Lantern',
  'Tidal',
  'Cobalt',
  'Maple',
  'Signal',
  'Pocket',
  'Granite',
  'Echo',
  'Meadow',
  'Atlas',
  'Prism',
];
const PROJECT_NOUN = [
  'Ledger',
  'Planner',
  'Tracker',
  'Gateway',
  'Notebook',
  'Dashboard',
  'Router',
  'Atlas',
  'Scheduler',
  'Garden',
  'Pipeline',
  'Compass',
  'Market',
  'Studio',
  'Inbox',
  'Library',
];

/** Exact experience-tag -> job title pool. */
export const EXP_TITLES: Record<string, string[]> = {
  'exp-frontend': ['Frontend Engineer', 'Frontend Developer', 'UI Engineer'],
  'exp-backend': ['Backend Engineer', 'Backend Developer', 'API Engineer'],
  'exp-mobile': ['Mobile Developer', 'Mobile Engineer'],
  'exp-data': ['Data Engineer', 'Analytics Engineer'],
  'exp-ml': ['Machine Learning Engineer', 'Data Scientist', 'ML Engineer'],
  'exp-devops': [
    'DevOps Engineer',
    'Platform Engineer',
    'Site Reliability Engineer',
  ],
  'exp-qa': ['QA Automation Engineer', 'Test Automation Engineer'],
  'exp-security': ['Security Engineer', 'Application Security Engineer'],
};
export const FULL_STACK_TITLES = [
  'Full-Stack Developer',
  'Full-Stack Engineer',
];
export const GENERIC_TITLES = ['Software Engineer', 'Software Developer'];

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface Identity {
  name: string;
  slug: string;
}

/** A unique fictional identity; `used` collects the slugs handed out. */
export function makeIdentity(
  rng: Rng,
  language: 'en' | 'uk',
  used: Set<string>,
): Identity {
  const useUk = language === 'uk' || rng.chance(0.1);
  const first = rng.pick(useUk ? FIRST_UK : FIRST_EN);
  const last = rng.pick(useUk ? LAST_UK : LAST_EN);
  const name = `${first} ${last}`;
  let slug = slugify(name);
  for (let n = 2; used.has(slug); n++) slug = `${slugify(name)}-${n}`;
  used.add(slug);
  return { name, slug };
}

export function projectName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const name = `${rng.pick(PROJECT_ADJ)} ${rng.pick(PROJECT_NOUN)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Project ${used.size + 1}`;
  used.add(fallback);
  return fallback;
}
