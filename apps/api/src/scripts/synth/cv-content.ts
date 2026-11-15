/**
 * The CV content the `cvs` stage writes to `data/synthetic/cvs/<id>.json` and
 * the `render` stage turns into `cvs/<id>.html` and `pdf/<id>.pdf`.
 *
 * The LLM writes the prose; everything structural (employers, titles, dates,
 * project names, contacts) is copied from the persona spec by code, so the
 * timeline the ground truth is computed from can't drift.
 */
export interface CvRole {
  /** From the spec, in spec order (oldest first); renderers show newest first. */
  employer: string;
  title: string;
  /** `YYYY-MM`. */
  start: string;
  /** `YYYY-MM`, or null for the current role. */
  end: string | null;
  /** LLM-written; must mention exactly the role's tags. */
  bullets: string[];
}

export interface CvProject {
  /** From the spec. */
  name: string;
  /** LLM-written; must mention exactly the project's tags. */
  description: string;
}

export interface CvEducation {
  degree: string;
  school: string;
  /** Year, e.g. `2019`. */
  end: string;
}

export interface CvContent {
  personaId: string;
  language: 'en' | 'uk';
  /** Copied from the spec. */
  name: string;
  email: string;
  /** `https://github.com/<username>`, or null. */
  githubUrl: string | null;
  /** LLM-written, e.g. "Backend Engineer". */
  headline: string;
  location: string;
  summary: string;
  roles: CvRole[];
  projects: CvProject[];
  /** The skills section: display labels, including every `cv_skills_only` tag. */
  skills: string[];
  education: CvEducation[];
  /** Spoken languages, e.g. "English (C1)". */
  spokenLanguages: string[];
  /**
   * Injection personas only: the fixed injection text, added by code (never
   * by the LLM) and rendered as a normal-looking paragraph.
   */
  injection: string | null;
}
