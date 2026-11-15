/**
 * Builds the HTML of a synthetic CV from `CvContent`. The templates in
 * `data/synthetic/templates/` only hold the skeleton and the CSS (placeholders
 * `{{lang}}`, `{{title}}`, `{{body}}`); the markup of each layout is built
 * here so every piece of text goes through one escaping function.
 */
import type {
  CvContent,
  CvEducation,
  CvProject,
  CvRole,
} from './cv-content.js';
import type { Language, Layout } from './types.js';

export const LAYOUTS: readonly Layout[] = ['1-col', '2-col', 'compact'];

export interface Headings {
  contact: string;
  summary: string;
  experience: string;
  projects: string;
  skills: string;
  education: string;
  languages: string;
}

export const HEADINGS: Record<Language, Headings> = {
  en: {
    contact: 'Contact',
    summary: 'Summary',
    experience: 'Experience',
    projects: 'Projects',
    skills: 'Skills',
    education: 'Education',
    languages: 'Languages',
  },
  uk: {
    contact: 'Контакти',
    summary: 'Про себе',
    experience: 'Досвід роботи',
    projects: 'Проєкти',
    skills: 'Навички',
    education: 'Освіта',
    languages: 'Мови',
  },
};

const MONTHS: Record<Language, readonly string[]> = {
  en: [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ],
  uk: [
    'січ.',
    'лют.',
    'бер.',
    'квіт.',
    'трав.',
    'черв.',
    'лип.',
    'серп.',
    'вер.',
    'жовт.',
    'лист.',
    'груд.',
  ],
};

const PRESENT: Record<Language, string> = { en: 'Present', uk: 'дотепер' };

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `2021-03` -> `Mar 2021` (`бер. 2021` for uk). */
export function formatMonth(value: string, language: Language): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) {
    throw new Error(`Invalid month "${value}", expected YYYY-MM`);
  }
  return `${MONTHS[language][month - 1]} ${match[1]}`;
}

/** `Mar 2021 – Present`. */
export function formatPeriod(
  start: string,
  end: string | null,
  language: Language,
): string {
  const to = end === null ? PRESENT[language] : formatMonth(end, language);
  return `${formatMonth(start, language)} – ${to}`;
}

/** Current role first, then by end date, then by start date (all descending). */
export function rolesNewestFirst(roles: readonly CvRole[]): CvRole[] {
  const key = (r: CvRole) => `${r.end ?? '9999-99'}|${r.start}`;
  return [...roles].sort((a, b) => key(b).localeCompare(key(a)));
}

/** `https://github.com/user` -> `github.com/user` (as people write it on a CV). */
export function githubDisplay(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

const e = escapeHtml;
const lines = (items: string[]): string => items.join('\n');

function roleHtml(role: CvRole, language: Language): string {
  return `<div class="job">
  <div class="row"><span>${e(role.title)}</span><span class="dates">${e(formatPeriod(role.start, role.end, language))}</span></div>
  <div class="sub">${e(role.employer)}</div>
  <ul>
${lines(role.bullets.map((b) => `    <li>${e(b)}</li>`))}
  </ul>
</div>`;
}

function projectHtml(project: CvProject): string {
  return `<div class="project">
  <div class="row"><span>${e(project.name)}</span></div>
  <p>${e(project.description)}</p>
</div>`;
}

function educationHtml(edu: CvEducation): string {
  return `<div class="edu">
  <div class="row"><span>${e(edu.degree)}</span><span class="dates">${e(edu.end)}</span></div>
  <div class="sub">${e(edu.school)}</div>
</div>`;
}

const listItems = (items: string[], cls = ''): string =>
  `<ul${cls ? ` class="${cls}"` : ''}>\n${lines(items.map((i) => `  <li>${e(i)}</li>`))}\n</ul>`;

function section(heading: string, html: string, present: boolean): string {
  return present ? `<h2>${e(heading)}</h2>\n${html}` : '';
}

const noteHtml = (cv: CvContent): string =>
  cv.injection ? `<p class="note">${e(cv.injection)}</p>` : '';

const join = (parts: string[]): string => parts.filter(Boolean).join('\n');

function singleColumnBody(cv: CvContent, layout: '1-col' | 'compact'): string {
  const h = HEADINGS[cv.language];
  const contacts = [
    e(cv.email),
    e(cv.location),
    ...(cv.githubUrl ? [e(githubDisplay(cv.githubUrl))] : []),
  ];
  const header =
    layout === 'compact'
      ? `<header>
  <div><h1>${e(cv.name)}</h1><div class="headline">${e(cv.headline)}</div></div>
  <div class="contact">${lines(contacts.map((c) => `<div>${c}</div>`))}</div>
</header>`
      : `<h1>${e(cv.name)}</h1>
<div class="headline">${e(cv.headline)}</div>
<div class="contact">${contacts.join(' &middot; ')}</div>`;

  return join([
    header,
    section(h.summary, `<p>${e(cv.summary)}</p>`, cv.summary !== ''),
    section(
      h.experience,
      lines(rolesNewestFirst(cv.roles).map((r) => roleHtml(r, cv.language))),
      cv.roles.length > 0,
    ),
    section(
      h.projects,
      lines(cv.projects.map(projectHtml)),
      cv.projects.length > 0,
    ),
    section(h.skills, listItems(cv.skills, 'skills'), cv.skills.length > 0),
    section(
      h.education,
      lines(cv.education.map(educationHtml)),
      cv.education.length > 0,
    ),
    section(
      h.languages,
      listItems(cv.spokenLanguages),
      cv.spokenLanguages.length > 0,
    ),
    noteHtml(cv),
  ]);
}

function twoColumnBody(cv: CvContent): string {
  const h = HEADINGS[cv.language];
  const contacts = [
    cv.email,
    cv.location,
    ...(cv.githubUrl ? [githubDisplay(cv.githubUrl)] : []),
  ];
  const side = join([
    section(h.contact, listItems(contacts), true),
    section(h.skills, listItems(cv.skills), cv.skills.length > 0),
    section(
      h.languages,
      listItems(cv.spokenLanguages),
      cv.spokenLanguages.length > 0,
    ),
    section(
      h.education,
      lines(cv.education.map(educationHtml)),
      cv.education.length > 0,
    ),
  ]);
  const main = join([
    `<h1>${e(cv.name)}</h1>\n<div class="headline">${e(cv.headline)}</div>`,
    section(h.summary, `<p>${e(cv.summary)}</p>`, cv.summary !== ''),
    section(
      h.experience,
      lines(rolesNewestFirst(cv.roles).map((r) => roleHtml(r, cv.language))),
      cv.roles.length > 0,
    ),
    section(
      h.projects,
      lines(cv.projects.map(projectHtml)),
      cv.projects.length > 0,
    ),
    noteHtml(cv),
  ]);
  return `<div class="page">
<aside class="side">
${side}
</aside>
<main class="main">
${main}
</main>
</div>`;
}

/** The `{{body}}` markup of a layout. */
export function renderCvBody(cv: CvContent, layout: Layout): string {
  return layout === '2-col' ? twoColumnBody(cv) : singleColumnBody(cv, layout);
}

/** Fills a template file (`{{lang}}`, `{{title}}`, `{{body}}`) with the CV. */
export function renderCvHtml(
  cv: CvContent,
  layout: Layout,
  template: string,
): string {
  const values: Record<string, string> = {
    lang: cv.language,
    title: e(`${cv.name} - ${cv.language === 'uk' ? 'резюме' : 'CV'}`),
    body: renderCvBody(cv, layout),
  };
  if (!template.includes('{{body}}')) {
    throw new Error('Template has no {{body}} placeholder');
  }
  return template.replace(
    /\{\{(lang|title|body)\}\}/g,
    (_m, key: string) => values[key],
  );
}
