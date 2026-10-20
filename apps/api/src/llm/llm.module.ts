import { Module } from '@nestjs/common';
import { ApplicationScorer } from './application-scorer.js';
import { CriteriaExtractor } from './criteria-extractor.js';
import { CvProfileParser } from './cv-profile-parser.js';
import { LlmClient } from './llm-client.js';

@Module({
  providers: [LlmClient, CvProfileParser, CriteriaExtractor, ApplicationScorer],
  exports: [LlmClient, CvProfileParser, CriteriaExtractor, ApplicationScorer],
})
export class LlmModule {}
