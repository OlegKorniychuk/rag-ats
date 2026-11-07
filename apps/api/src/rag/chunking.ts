// Splits a candidate's CV text and GitHub snapshot into chunks for embedding.
// Pure: no Nest, no I/O. Chunk text stays verbatim (modulo whitespace), because
// later steps verify quotes against it.

import type { GithubSnapshot } from '../github/github-snapshot.js';
import {
  renderGithubLanguage,
  renderGithubProfile,
  renderGithubRepo,
} from '../llm/prompts/cv-profile.prompt.js';

export interface TextChunk {
  source: 'cv' | 'github';
  text: string;
}

/** Whole lines are packed into a CV chunk up to this many characters. */
export const CV_CHUNK_MAX_CHARS = 1000;
/** The previous chunk's last line is repeated in the next one if it is this short. */
export const CV_CHUNK_OVERLAP_MAX_CHARS = 200;
/** Profile and per-repo GitHub chunks are truncated to this many characters. */
export const GITHUB_CHUNK_MAX_CHARS = 1500;
/** CV chunks come first, so a huge CV can crowd out GitHub chunks. */
export const MAX_CHUNKS_PER_CANDIDATE = 60;

/** `end` moved back by one when it would split a surrogate pair. */
function safeEnd(text: string, end: number): number {
  if (end >= text.length || end <= 0) return Math.min(end, text.length);
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

/** Packs `pieces` greedily with `separator` into parts of at most `max` chars. */
function packPieces(
  pieces: string[],
  separator: string,
  max: number,
): string[] {
  const parts: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current === '') {
      current = piece;
    } else if (current.length + separator.length + piece.length <= max) {
      current += separator + piece;
    } else {
      parts.push(current);
      current = piece;
    }
  }
  if (current !== '') parts.push(current);
  return parts;
}

function hardCut(word: string, max: number): string[] {
  const parts: string[] = [];
  for (let start = 0; start < word.length;) {
    const end = safeEnd(word, start + max);
    parts.push(word.slice(start, end));
    start = end;
  }
  return parts;
}

/**
 * Splits one over-long line into parts of at most `max` chars: packed
 * sentences (`. `, `! `, `? `), falling back to packed words for a sentence
 * that is still too long, and a hard cut for a single word that is too long.
 * Parts are joined by single spaces where the line had whitespace.
 */
function splitLongLine(line: string, max: number): string[] {
  const sentences = line.split(/(?<=[.!?])\s+/).filter((s) => s !== '');
  const parts: string[] = [];
  let run: string[] = [];
  const flushRun = () => {
    parts.push(...packPieces(run, ' ', max));
    run = [];
  };
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      run.push(sentence);
      continue;
    }
    flushRun();
    const words = sentence.split(/\s+/).filter((w) => w !== '');
    const pieces = words.flatMap((w) =>
      w.length > max ? hardCut(w, max) : [w],
    );
    // Hard-cut pieces of one word are never re-joined: every full-size piece
    // leaves no room for a neighbour, so packing keeps them apart.
    parts.push(...packPieces(pieces, ' ', max));
  }
  flushRun();
  return parts;
}

function lengthOf(lines: string[]): number {
  return lines.reduce((sum, line) => sum + line.length, 0) + lines.length - 1;
}

/**
 * Chunks extracted CV text: blank lines are dropped and whole lines are packed
 * greedily into chunks of at most `CV_CHUNK_MAX_CHARS`, joined by `\n`. A
 * chunk starts with the previous chunk's last line when that line is short
 * (overlap). A line longer than the maximum is split on its own (see
 * `splitLongLine`) into chunks without overlap.
 */
export function chunkCvText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');

  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.length > CV_CHUNK_MAX_CHARS) {
      if (current.length > 0) chunks.push(current.join('\n'));
      current = [];
      chunks.push(...splitLongLine(line, CV_CHUNK_MAX_CHARS));
      continue;
    }
    if (
      current.length > 0 &&
      lengthOf(current) + 1 + line.length > CV_CHUNK_MAX_CHARS
    ) {
      chunks.push(current.join('\n'));
      const last = current[current.length - 1];
      const overlap =
        last.length <= CV_CHUNK_OVERLAP_MAX_CHARS &&
        last.length + 1 + line.length <= CV_CHUNK_MAX_CHARS;
      current = overlap ? [last] : [];
    }
    current.push(line);
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

function capGithubChunk(text: string): string {
  return text.slice(0, safeEnd(text, GITHUB_CHUNK_MAX_CHARS)).trimEnd();
}

/**
 * One profile chunk (URL, bio, languages) and one chunk per repository, in
 * snapshot order. Text is rendered (and escaped) exactly as in the scorer's
 * `<github>` block. Only a successfully fetched snapshot yields chunks.
 */
export function chunkGithubSnapshot(snapshot: GithubSnapshot | null): string[] {
  if (!snapshot || snapshot.status !== 'ok') return [];
  const profile = renderGithubProfile(snapshot);
  if (snapshot.languages.length > 0) {
    profile.push(
      `Languages: ${snapshot.languages
        .map((language) => renderGithubLanguage(language.name))
        .join(', ')}`,
    );
  }
  return [profile.join('\n'), ...snapshot.repos.map(renderGithubRepo)].map(
    capGithubChunk,
  );
}

/** CV chunks first, then GitHub chunks, capped at `MAX_CHUNKS_PER_CANDIDATE`. */
export function chunkCandidate(
  cvText: string,
  snapshot: GithubSnapshot | null,
): TextChunk[] {
  const chunks: TextChunk[] = [
    ...chunkCvText(cvText).map((text) => ({ source: 'cv' as const, text })),
    ...chunkGithubSnapshot(snapshot).map((text) => ({
      source: 'github' as const,
      text,
    })),
  ];
  return chunks.slice(0, MAX_CHUNKS_PER_CANDIDATE);
}
