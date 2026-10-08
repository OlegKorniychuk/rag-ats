import { Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';

const PDF_MAGIC = Buffer.from('%PDF-');

export class UnreadableCvError extends Error {
  constructor() {
    super('Could not read text from the CV PDF');
    this.name = 'UnreadableCvError';
  }
}

export function isPdf(buffer: Buffer): boolean {
  return (
    buffer.length >= PDF_MAGIC.length &&
    buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
  );
}

@Injectable()
export class CvTextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    // pdfjs may transfer/detach the underlying buffer, so hand it a copy
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const { text } = await parser.getText({ pageJoiner: '' });
      const trimmed = text.trim();
      if (!trimmed) throw new UnreadableCvError();
      return trimmed;
    } catch (err) {
      if (err instanceof UnreadableCvError) throw err;
      throw new UnreadableCvError();
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}
