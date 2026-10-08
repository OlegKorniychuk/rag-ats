import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmClient } from './llm-client.js';
import {
  CV_PROFILE_SCHEMA_NAME,
  cvProfileSchema,
  type ParsedProfile,
} from './cv-profile.schema.js';
import {
  CV_PROFILE_SYSTEM_PROMPT,
  cvProfileUserPrompt,
} from './prompts/cv-profile.prompt.js';

export const CV_TEXT_MAX_CHARS = 40_000;

export class LlmParseError extends Error {
  constructor(message = 'The model could not extract a profile from the CV') {
    super(message);
    this.name = 'LlmParseError';
  }
}

function normaliseText(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CV_TEXT_MAX_CHARS);
}

function cleanList(items: string[]): string[] {
  return items.map((i) => i.trim()).filter((i) => i.length > 0);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

@Injectable()
export class CvProfileParser {
  private readonly logger = new Logger(CvProfileParser.name);

  constructor(private readonly llm: LlmClient) {}

  async parse(cvText: string): Promise<ParsedProfile> {
    const text = normaliseText(cvText);

    let result;
    try {
      result = await this.llm.parseStructured({
        system: CV_PROFILE_SYSTEM_PROMPT,
        user: cvProfileUserPrompt(text),
        schema: cvProfileSchema,
        schemaName: CV_PROFILE_SCHEMA_NAME,
      });
    } catch (err) {
      // API/connection errors (already retried by the SDK) propagate as-is;
      // anything else thrown while parsing the output means invalid output.
      if (err instanceof OpenAI.APIError) throw err;
      throw new LlmParseError();
    }

    if (result.usage) {
      this.logger.log(
        `LLM usage: model=${result.usage.model} input_tokens=${result.usage.inputTokens} output_tokens=${result.usage.outputTokens} total_tokens=${result.usage.totalTokens}`,
      );
    }

    if (result.kind !== 'parsed') throw new LlmParseError();

    const p = result.parsed;
    return {
      skills: dedupe(cleanList(p.skills)),
      experience: p.experience.trim(),
      projects: dedupe(cleanList(p.projects)),
      summary: p.summary.trim(),
    };
  }
}
