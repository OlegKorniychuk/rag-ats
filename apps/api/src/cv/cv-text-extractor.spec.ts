import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CvTextExtractor,
  UnreadableCvError,
  isPdf,
} from './cv-text-extractor.js';

const fixture = (name: string): Buffer =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)),
  );

describe('CvTextExtractor', () => {
  const extractor = new CvTextExtractor();

  it('extracts text from a text PDF', async () => {
    const text = await extractor.extract(fixture('cv-text.pdf'));
    expect(text).toContain('Jane Doe');
    expect(text).toContain('Senior Backend Engineer, TypeScript, NestJS');
    expect(text).toBe(text.trim());
  });

  it('throws UnreadableCvError for a PDF with no extractable text', async () => {
    await expect(extractor.extract(fixture('cv-empty.pdf'))).rejects.toThrow(
      UnreadableCvError,
    );
  });

  it('throws UnreadableCvError for corrupt PDF bytes', async () => {
    await expect(
      extractor.extract(Buffer.from('%PDF-1.4\ngarbage')),
    ).rejects.toThrow(UnreadableCvError);
  });

  it('uses the expected error message', async () => {
    await expect(extractor.extract(Buffer.from('nope'))).rejects.toThrow(
      'Could not read text from the CV PDF',
    );
  });
});

describe('isPdf', () => {
  it('accepts a real PDF', () => {
    expect(isPdf(fixture('cv-text.pdf'))).toBe(true);
  });

  it('rejects a non-PDF file named .pdf', () => {
    expect(isPdf(fixture('not-a-pdf.pdf'))).toBe(false);
  });

  it('rejects an empty buffer', () => {
    expect(isPdf(Buffer.alloc(0))).toBe(false);
  });
});
