import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export function fixtureBytes(name: string): Buffer {
  return readFileSync(fixturePath(name));
}

export interface ApplyFields {
  name?: string;
  email?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  [extra: string]: string | undefined;
}

/**
 * Builds a multipart POST /apply/:token request with the given text fields
 * and a CV attachment (the text-PDF fixture by default). Returns the pending
 * supertest request so callers can chain `.expect(...)`.
 */
export function applyWithCv(
  app: INestApplication,
  token: string,
  fields: ApplyFields,
  fixture = 'cv-text.pdf',
  uploadName?: string,
): request.Test {
  const req = request(app.getHttpServer()).post(`/apply/${token}`);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) req.field(key, value);
  }
  return req.attach('cv', fixturePath(fixture), uploadName);
}
