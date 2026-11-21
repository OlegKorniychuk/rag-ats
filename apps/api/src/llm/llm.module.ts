import { Module } from '@nestjs/common';
import { ApplicationScorer } from './application-scorer.js';
import { CriteriaExtractor } from './criteria-extractor.js';
import { CvProfileParser } from './cv-profile-parser.js';
import { LlmClient } from './llm-client.js';
import { QuestionGenerator } from './question-generator.js';

@Module({
  providers: [
    LlmClient,
    CvProfileParser,
    CriteriaExtractor,
    ApplicationScorer,
    QuestionGenerator,
  ],
  exports: [
    LlmClient,
    CvProfileParser,
    CriteriaExtractor,
    ApplicationScorer,
    QuestionGenerator,
  ],
})
export class LlmModule {}
