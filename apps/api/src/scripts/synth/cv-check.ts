/**
 * Extraction check for rendered CVs: every piece of CV text must survive the
 * PDF -> text round trip of the production extractor, otherwise the ground
 * truth (built from the spec) would not match what the pipeline can read.
 */
import type { CvContent } from './cv-content.js';
import { githubDisplay } from './render-html.js';

/**
 * Comparison key: NFKC (ligatures, nbsp, full-width forms), no soft hyphens or
 * zero-width characters, one quote and dash style, lower case, and then no
 * whitespace and no hyphens at all. Dropping both makes "micro-\nservices",
 * "end-to-\nend" and a plain line wrap compare equal to the source text.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

/**
 * Every text snippet that must be found in the extracted PDF text. Dates are
 * left out (their format is the renderer's), and so is the injection text:
 * tiny hidden text may or may not extract and either is fine.
 */
export function requiredSnippets(cv: CvContent): string[] {
  return [
    cv.name,
    cv.email,
    cv.location,
    cv.headline,
    cv.summary,
    ...(cv.githubUrl ? [githubDisplay(cv.githubUrl)] : []),
    ...cv.roles.flatMap((r) => [r.title, r.employer, ...r.bullets]),
    ...cv.projects.flatMap((p) => [p.name, p.description]),
    ...cv.skills,
    ...cv.education.flatMap((ed) => [ed.degree, ed.school, ed.end]),
    ...cv.spokenLanguages,
  ].filter((s) => normalizeForMatch(s) !== '');
}

/** Snippets of the CV that do not appear in the extracted text. */
export function findMissingSnippets(
  cv: CvContent,
  extractedText: string,
): string[] {
  const haystack = normalizeForMatch(extractedText);
  return requiredSnippets(cv).filter(
    (snippet) => !haystack.includes(normalizeForMatch(snippet)),
  );
}

/** Structural problems of a `cvs/<id>.json` that would break the renderer. */
export function validateCvContent(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['not an object'];
  const cv = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of [
    'personaId',
    'name',
    'email',
    'headline',
    'location',
    'summary',
  ]) {
    if (typeof cv[key] !== 'string') problems.push(`${key} must be a string`);
  }
  if (cv.language !== 'en' && cv.language !== 'uk') {
    problems.push('language must be "en" or "uk"');
  }
  for (const key of [
    'roles',
    'projects',
    'skills',
    'education',
    'spokenLanguages',
  ]) {
    if (!Array.isArray(cv[key])) problems.push(`${key} must be an array`);
  }
  if (cv.githubUrl !== null && typeof cv.githubUrl !== 'string') {
    problems.push('githubUrl must be a string or null');
  }
  if (cv.injection !== null && typeof cv.injection !== 'string') {
    problems.push('injection must be a string or null');
  }
  return problems;
}
