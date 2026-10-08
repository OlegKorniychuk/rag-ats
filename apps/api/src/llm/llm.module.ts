import { Module } from '@nestjs/common';
import { CvProfileParser } from './cv-profile-parser.js';
import { LlmClient } from './llm-client.js';

@Module({
  providers: [LlmClient, CvProfileParser],
  exports: [LlmClient, CvProfileParser],
})
export class LlmModule {}
